-- Notifications scaffold — in-app notification feed.
--
-- This is the DB foundation for the bell-icon notifications surfaced in
-- the navbar. Email delivery is a separate feature (see
-- .audit/implementation-plans.md §3) that will read from this same table
-- and dispatch via Resend in a later iteration. This migration intentionally
-- does NOT touch email_log / trip_invites.recipient_email — keeps the
-- scaffold landable without the Resend account/DNS setup.
--
-- Design notes:
--   - `payload` is JSONB so each notification type carries the bare minimum
--     needed to render the dropdown without a join (e.g. trip title +
--     destination snippet). For deeper detail we link to the trip page.
--   - `read_at` is nullable; unread = NULL. We don't use a boolean so we
--     can later show "read 2h ago" timestamps.
--   - RLS: a user can SELECT/UPDATE their own rows. INSERTs are service-role
--     only — no client should be able to fabricate a notification for
--     another user. The API routes that detect events (vote cast, proposal
--     created, comment added) call enqueueNotification() via the service
--     role client.

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Discriminator. Keep this in sync with the NotificationType union in
    -- lib/notifications/types.ts. New types: add here AND in the TS union.
    type TEXT NOT NULL CHECK (type IN (
        'collab_vote',          -- someone voted on an activity in your trip
        'collab_comment',       -- someone commented (future)
        'collab_proposal',      -- collaborator proposed a new activity
        'invite_accepted',      -- a sent invite was accepted
        'trip_shared',          -- a shared-link trip got its first vote
        'system'                -- catch-all (release notes, etc.)
    )),
    -- JSON payload — schema varies by `type`. See lib/notifications/types.ts
    -- for the per-type shape. Always include at least { trip_id, message }.
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- NULL = unread. Set when the user opens the notification (or marks all
    -- read). Once set, we keep the row for history; archival is handled by
    -- the dropdown showing only the last 30 days.
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Soft-delete so users can clear without losing the audit trail.
    deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE public.notifications IS
    'In-app notifications surfaced in the navbar bell. Service-role INSERT only; user SELECT/UPDATE own.';

-- The dropdown query is "newest unread + recent read, my own only, last 30 days".
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON public.notifications (user_id, created_at DESC)
    WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
    ON public.notifications (user_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users see their own notifications.
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
    ON public.notifications
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can mark their own as read / soft-delete (UPDATE on their own rows).
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
    ON public.notifications
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- INSERT only via service role — no policy here means no client can insert.
-- (Service role bypasses RLS, which is exactly what enqueueNotification needs.)

-- Realtime: surface inserts so the bell badge updates without polling.
-- Matches the pattern in 20260219_enable_realtime_proposals.sql.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
