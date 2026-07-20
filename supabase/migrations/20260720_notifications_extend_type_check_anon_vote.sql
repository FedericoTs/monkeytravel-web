-- 2026-07-20 (Crew Loop): extend the notifications.type CHECK allowlist
-- with 'anon_vote' — an anonymous share-link visitor cast their first vote
-- on a trip (one notification per voter per trip, throttled in
-- app/api/shared/[token]/vote/route.ts).
--
-- Keep in sync with the NotificationType union in lib/notifications/types.ts
-- (see the header comment there — new types must land in BOTH places, or the
-- enqueue INSERT bounces on check_violation and is silently swallowed by
-- enqueueNotification's best-effort error handling).
--
-- Same drop-and-recreate pattern as
-- 20260530_bananas_extend_transaction_type_check.sql.

BEGIN;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'collab_vote',          -- someone voted on an activity in your trip
    'collab_comment',       -- someone commented (future)
    'collab_proposal',      -- collaborator proposed a new activity
    'invite_accepted',      -- a sent invite was accepted
    'trip_shared',          -- a shared-link trip got its first vote
    'anon_vote',            -- NEW 2026-07-20: anonymous crew vote via share link
    'system'                -- catch-all (release notes, etc.)
  ));

COMMIT;
