-- 20260601 — scheduled_notifications: per-trip cascade queue
--
-- Background
-- ----------
-- Phase 3 of the calendar-export + smart-notifications feature (see
-- docs/specs/calendar-export-smart-notifs.md) ships a zero-config
-- pre-trip cascade: when a trip is saved with a future start_date,
-- five rows are enqueued (T-14d, T-7d, T-3d, T-1d, morning-of). A
-- Vercel cron sweeps every 15 minutes, picks up due rows, dispatches
-- a slot-specific email via lib/email/send.ts, and marks them sent.
--
-- Why a queue table (not "compute from trips at cron-time")
-- ---------------------------------------------------------
-- 1. Idempotency: UNIQUE (trip_id, slot) prevents double-sends if the
--    cron lags + the enqueue path retries.
-- 2. Audit: a row's lifecycle (pending → sent / suppressed / failed)
--    gives us a queryable record of what we tried to send + when, which
--    matters for support ("the user says they never got the 7-day
--    email — did we try?").
-- 3. Mute toggle: the user can mute a trip's cascade by deleting the
--    pending rows for that trip (cheap, no recompute), and re-enqueue
--    on un-mute (the RPC is idempotent).
-- 4. Rate limit: the cron suppresses a slot if any sibling slot for
--    the same trip went out in the last 24h — easy to express as a
--    JOIN on the same table.
--
-- CAUSALITY (consumers)
-- ---------------------
-- - lib/notifications/scheduling.ts          — calls enqueue_trip_notifications
-- - lib/trips/persistTrip.ts (insertTrip)    — enqueues after first save
-- - app/api/trips/[id]/route.ts (PATCH)      — re-enqueues on start_date change
-- - app/api/cron/scheduled-notifications/route.ts — sweeps + dispatches
-- - lib/email/templates/TripReminderEmail.tsx     — per-slot email
--
-- POST-MORTEM AWARENESS
-- ---------------------
-- The cron route lives outside [locale]/ and uses next-intl
-- getTranslations({ locale }) explicitly per recipient — so it/es
-- emails render correctly even though the request has no locale.

-- ---------------------------------------------------------------------------
-- 1. reminders_muted on trips
-- ---------------------------------------------------------------------------

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS reminders_muted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.trips.reminders_muted IS
  'Per-trip mute toggle for the pre-trip cascade. When TRUE, enqueue_trip_notifications() returns 0 and the cron route ignores any leftover rows for this trip. Flipping false → true does NOT auto-delete pending rows (the cron check is the gate); flipping true → false requires re-running enqueue_trip_notifications().';

-- ---------------------------------------------------------------------------
-- 2. scheduled_notifications table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id         UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  -- Slot enum encoded as TEXT + CHECK (matches the PRD + the codebase's
  -- existing pattern for notification.type — keeps the migration
  -- additive without an enum-type bump).
  slot            TEXT NOT NULL CHECK (slot IN
    ('pack_early_14d','visa_check_7d','weather_3d','confirm_1d','morning_of')),
  scheduled_for   TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','suppressed','failed')),
  sent_at         TIMESTAMPTZ,
  -- Why a row failed / was suppressed (e.g. "rate_limit_sibling_24h",
  -- "muted", "user_opted_out"). Short text — bounded by code, not by
  -- user input — so no length cap.
  skipped_reason  TEXT,
  -- Last error from a failed dispatch attempt — first 500 chars.
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per (trip, slot) — the enqueue RPC relies on this to be
  -- safely re-runnable (DELETE pending → INSERT). Without UNIQUE a
  -- network blip + retry would double-schedule.
  UNIQUE (trip_id, slot)
);

-- Partial index on the due queue — the cron's hot path is
-- "WHERE status='pending' AND scheduled_for <= NOW()". Partial keeps
-- the index small (most rows transition to sent quickly).
CREATE INDEX IF NOT EXISTS sn_due_idx
  ON public.scheduled_notifications (scheduled_for)
  WHERE status = 'pending';

-- Per-trip lookup for the mute toggle + the rate-limit check.
CREATE INDEX IF NOT EXISTS sn_trip_idx
  ON public.scheduled_notifications (trip_id);

ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- Owners can read their own scheduled rows (powers a future "your
-- upcoming reminders" UI on /profile/notifications). Writes are
-- service-role only — the cron + the enqueue RPC are the only writers.
CREATE POLICY "sn_select_own"
  ON public.scheduled_notifications
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.scheduled_notifications IS
  'Pre-trip email cascade queue. Populated by enqueue_trip_notifications(trip_id, user_id), drained by app/api/cron/scheduled-notifications. UNIQUE (trip_id, slot) keeps the enqueue path safely re-runnable. RLS: owners can read; writes via service-role.';

-- ---------------------------------------------------------------------------
-- 3. enqueue_trip_notifications RPC
-- ---------------------------------------------------------------------------
--
-- Called from lib/notifications/scheduling.ts (which itself is
-- invoked by lib/trips/persistTrip.ts after a successful INSERT, and
-- by PATCH /api/trips/[id] when start_date changes).
--
-- Behaviour:
--   - If the trip is muted, returns 0.
--   - If the trip has no start_date or start_date < NOW(), returns 0.
--   - Otherwise wipes any PENDING rows for the trip (so re-enqueue
--     after a start_date change is correct) and inserts up to 5 rows
--     (one per slot whose scheduled_for is still in the future).
--   - Returns the number of rows inserted.
--
-- Notes:
--   - `morning_of` = 09:00 local on the trip start date. We don't know
--     the destination timezone here (computing it would require a
--     round-trip to Google Places). We approximate with 09:00 UTC of
--     start_date — close enough for "morning-of" semantics across most
--     timezones, and the dispatcher gets that 09:00 UTC slot rendered
--     in the user's preferred_language. Phase 3.5 can swap in
--     destination-tz lookup once the cache lands.
--   - SECURITY DEFINER + explicit search_path so the function ignores
--     the caller's search_path (mirrors lib/calendar/google-oauth.ts
--     and 20260530_activity_index_mview.sql patterns).
--   - Returns INT not VOID so the caller can log "scheduled N slots".

CREATE OR REPLACE FUNCTION public.enqueue_trip_notifications(
  p_trip_id UUID,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start   TIMESTAMPTZ;
  v_muted   BOOLEAN;
  v_count   INT := 0;
BEGIN
  SELECT
    start_date::timestamptz + INTERVAL '9 hours',
    COALESCE(reminders_muted, FALSE)
  INTO v_start, v_muted
  FROM trips
  WHERE id = p_trip_id AND user_id = p_user_id;

  IF v_start IS NULL OR v_muted OR v_start < NOW() THEN
    -- Wipe any pending rows so a previously-scheduled trip whose
    -- start_date got pushed into the past doesn't keep firing.
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending';
    RETURN 0;
  END IF;

  -- Idempotent re-enqueue: drop pending rows, then re-insert based
  -- on the current start_date. Already-sent rows are preserved so the
  -- rate-limit check in the cron still has the 24h history.
  DELETE FROM scheduled_notifications
   WHERE trip_id = p_trip_id AND status = 'pending';

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT
    p_user_id,
    p_trip_id,
    slot,
    v_start - offset_intv
  FROM (VALUES
    ('pack_early_14d', INTERVAL '14 days'),
    ('visa_check_7d',  INTERVAL '7 days'),
    ('weather_3d',     INTERVAL '3 days'),
    ('confirm_1d',     INTERVAL '1 day'),
    ('morning_of',     INTERVAL '0')
  ) AS s(slot, offset_intv)
  WHERE v_start - offset_intv > NOW()
  ON CONFLICT (trip_id, slot) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_trip_notifications(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_trip_notifications(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.enqueue_trip_notifications(UUID, UUID) IS
  'Idempotent enqueue of the 5-slot pre-trip reminder cascade. SECURITY DEFINER so service_role callers can write through RLS. Returns the number of rows inserted (0 if muted / no future start_date / start in past).';
