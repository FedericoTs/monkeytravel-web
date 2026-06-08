-- Soft-delete pattern for trips. Prior to 2026-06-07 the DELETE handler hard-deleted
-- rows, losing all activity / conversation / share-link context. The "david cassoni"
-- incident (signup 16:21, trip + 7 Concierge questions over 17 min, then trip
-- vanished) made the cost concrete. Soft-delete keeps the row + lets us restore.

-- 1. Column. Nullable + no default so existing rows stay live.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Partial index on live rows. Every SELECT now adds `deleted_at IS NULL`
-- to the WHERE clause via RLS; the partial index lets that filter use an
-- index scan instead of seqscan once the table grows.
CREATE INDEX IF NOT EXISTS trips_deleted_at_live_idx
  ON public.trips (deleted_at)
  WHERE deleted_at IS NULL;

-- 3. Rewrite SELECT policy. The whole consolidated rule gets wrapped in
-- `deleted_at IS NULL AND (...)` so deleted trips disappear from /trips,
-- /shared/[token], /explore, /it/explore, search results — every read.
DROP POLICY IF EXISTS trips_select_consolidated ON public.trips;
CREATE POLICY trips_select_consolidated ON public.trips
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (user_id = (SELECT auth.uid()))
      OR (share_token IS NOT NULL)
      OR ((is_template = true) AND (visibility = 'public'))
      OR EXISTS (
        SELECT 1 FROM trip_collaborators
        WHERE trip_collaborators.trip_id = trips.id
          AND trip_collaborators.user_id = (SELECT auth.uid())
      )
      OR ((visibility = 'public') AND (share_token IS NOT NULL) AND (is_hidden = false))
    )
  );

-- 4. Rewrite UPDATE policy to block edits on already-deleted rows. The
-- USING clause is evaluated against the OLD row, so SET deleted_at = NOW()
-- still succeeds on a live row (deleted_at IS NULL). Subsequent updates
-- on the now-tombstoned row fail USING. No WITH CHECK so we don't trap
-- the soft-delete itself.
DROP POLICY IF EXISTS trips_update ON public.trips;
CREATE POLICY trips_update ON public.trips
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      (user_id = (SELECT auth.uid()))
      OR EXISTS (
        SELECT 1 FROM trip_collaborators
        WHERE trip_collaborators.trip_id = trips.id
          AND trip_collaborators.user_id = (SELECT auth.uid())
          AND trip_collaborators.role = 'editor'
      )
    )
  );

-- 5. We INTENTIONALLY leave trips_delete_own intact. The new DELETE
-- handler in app/api/trips/[id]/route.ts will issue UPDATE deleted_at
-- instead of DELETE; the policy stays as a safety hatch for admin/cron
-- hard-delete of very old tombstones (out of scope for this migration).

COMMENT ON COLUMN public.trips.deleted_at IS
  'Soft-delete timestamp. NULL = live. NOT NULL = tombstoned (hidden by RLS, recoverable via UPDATE to NULL). Hard DELETE remains possible via the trips_delete_own policy but is not used by the app DELETE handler.';
