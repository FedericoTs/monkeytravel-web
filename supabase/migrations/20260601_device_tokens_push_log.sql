-- Push notifications infrastructure (Phase B1 — server-side foundation).
--
-- Two tables: device_tokens (one row per device per user) and push_log
-- (one row per outbound push, kept for observability + suppression).
--
-- Wired only at the DB layer in this migration; API endpoints + the
-- APNs/FCM dispatcher land in follow-up commits. Tables are useless on
-- their own — but shipping the schema independently means we can
-- review the data model + RLS in isolation before introducing new
-- write paths.
--
-- Scope of this migration:
--   - device_tokens: user_id, token (UNIQUE), platform, app_version,
--     locale, created_at, last_seen_at, suppressed_at
--   - push_log:     user_id, notification_type, payload, sent/bounce
--                   counts, created_at
--   - RLS: users own their tokens (read/insert/delete); push_log is
--     read-only for the owning user; both tables are server-write only
--     for the actual push fan-out (no INSERT policy for authenticated
--     on push_log — service role inserts via SECURITY DEFINER RPC
--     when we add it).
--
-- Architecture decisions:
--
--   1. token is UNIQUE not (user_id, token). Same physical device CAN
--      register tokens for different users (account-switch on same
--      phone). The platform's token rotation handles this: when a user
--      signs out + signs in as a different user, the new token comes
--      back IDENTICAL but we DELETE the old row first via the sign-out
--      cleanup. If somehow two users hold the same token row, that's
--      a bug we want to fail-loud on, hence UNIQUE.
--
--   2. suppressed_at instead of hard-delete on APNs Unregistered /
--      FCM NotRegistered errors. Keeps the row for audit ("this token
--      was registered, here's when it bounced") without re-trying
--      forever. A future cron can hard-delete tokens suppressed > 90d.
--
--   3. payload is JSONB not text — we want to query "which users got
--      the trip_reminder_3d push" without parsing strings.
--
--   4. push_log.sent_count + bounce_count are aggregates per send
--      attempt (one row per notification_type-event for a user, not
--      per device). Simpler than one-row-per-token; we care about
--      "did this user get notified" not "did this device get notified."
--
--   5. No FK on push_log.user_id ON DELETE SET NULL — when a user
--      deletes their account, their push history is cascaded out. If
--      we ever need cross-account analytics we'll add a separate
--      anonymized aggregates table.

-- =====================================================================
-- device_tokens
-- =====================================================================

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Provider-issued token. APNs tokens are 64 hex chars (256 bits);
  -- FCM tokens are variable-length base64 strings (~150-200 chars).
  -- TEXT covers both without truncation.
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  -- App version at registration time. Helps when debugging payload
  -- bugs that only affect specific builds (e.g. "old app version
  -- doesn't render rich notifications").
  app_version TEXT,
  -- Locale at registration time. Lets the dispatcher localize push
  -- copy WITHOUT having to re-query the user's profile (avoids a
  -- per-device DB roundtrip during fan-out). When the user changes
  -- locale we re-register the token.
  locale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Updated on every successful re-registration (e.g. token refresh,
  -- app version bump). Cron can prune tokens with last_seen_at older
  -- than ~180d as dead devices.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when APNs returns Unregistered or FCM returns NotRegistered.
  -- Stop sending to this token; keep the row for audit + analytics.
  suppressed_at TIMESTAMPTZ
);

-- Active-tokens lookup: dispatcher's hot path is "give me all
-- non-suppressed tokens for this user." Partial index keeps the index
-- tight (only the rows we actually scan) and avoids index bloat from
-- the long-tail of suppressed historical tokens.
CREATE INDEX IF NOT EXISTS device_tokens_user_id_active_idx
  ON device_tokens(user_id)
  WHERE suppressed_at IS NULL;

-- Maintenance / debugging: occasional "show me this token" lookups
-- from the admin panel. UNIQUE on token already gives us the index;
-- adding nothing extra here.

-- =====================================================================
-- push_log
-- =====================================================================

CREATE TABLE IF NOT EXISTS push_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-form category for filtering in PostHog + the admin dashboard.
  -- Conventions: snake_case, prefix by surface: trip_reminder_3d,
  -- collab_activity_added, vote_needed, post_trip_review_prompt, etc.
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  -- Number of devices the dispatcher successfully handed the push to.
  -- Doesn't mean the user SAW it — APNs/FCM only confirm acceptance
  -- into their delivery pipeline. Real "opened" tracking needs the
  -- client to fire an analytics event on tap; that lands with B1
  -- client wiring.
  sent_count INTEGER NOT NULL DEFAULT 0,
  -- Number of devices that returned Unregistered / NotRegistered /
  -- other terminal errors. Incremented synchronously by the dispatcher
  -- before suppressing the offending token.
  bounce_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user history lookup ("show me all pushes for this user") — for
-- the eventual user-facing /profile/notifications history view + for
-- support debugging.
CREATE INDEX IF NOT EXISTS push_log_user_id_created_at_idx
  ON push_log(user_id, created_at DESC);

-- Per-type aggregation ("how many trip_reminder_3d pushes sent today")
-- — for the admin dashboard + cron-job monitoring.
CREATE INDEX IF NOT EXISTS push_log_notification_type_created_at_idx
  ON push_log(notification_type, created_at DESC);

-- =====================================================================
-- RLS — device_tokens
-- =====================================================================

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- Users can see THEIR OWN tokens (account settings + debug visibility).
CREATE POLICY "users read own device_tokens"
  ON device_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- Users can register a token tied to their own user_id.
CREATE POLICY "users insert own device_tokens"
  ON device_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own tokens (sign-out cleanup). No UPDATE
-- policy intentionally: tokens are immutable. "Rotate" = delete +
-- insert, which lets us track each rotation as its own row + makes
-- the audit trail cleaner.
CREATE POLICY "users delete own device_tokens"
  ON device_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypasses RLS (Supabase built-in). The dispatcher uses
-- the service role to read tokens during fan-out + to set
-- suppressed_at on bounce.

-- =====================================================================
-- RLS — push_log
-- =====================================================================

ALTER TABLE push_log ENABLE ROW LEVEL SECURITY;

-- Users can see their own push history (transparency + future
-- "notifications inbox" surface).
CREATE POLICY "users read own push_log"
  ON push_log FOR SELECT
  USING (auth.uid() = user_id);

-- NO INSERT/UPDATE/DELETE policy for authenticated. The dispatcher
-- writes via service role only. If we ever want a "mark as read" UI
-- we'll add an UPDATE policy scoped to read_at-only changes.

-- =====================================================================
-- Backfill / migration safety
-- =====================================================================

-- This migration is purely additive — no existing rows touched.
-- Safe to apply on a live DB without downtime.
--
-- Rollback: DROP TABLE push_log; DROP TABLE device_tokens; (drops the
-- indexes + policies with it).
