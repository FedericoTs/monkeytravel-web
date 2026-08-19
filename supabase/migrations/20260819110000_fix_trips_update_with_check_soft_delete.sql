-- Fix: deleting a trip has been impossible for every user since 2026-06-08.
--
-- SYMPTOM
-- DELETE /api/trips/[id] soft-deletes by stamping deleted_at. Every attempt
-- failed with 42501 "new row violates row-level security policy for table
-- trips", surfaced to the user as a 500 "Failed to delete trip". Reproduced
-- against production as the real owner of a real trip before writing this.
--
-- CAUSE
-- 20260608062036_trips_soft_delete.sql created trips_update with a USING
-- clause requiring `deleted_at IS NULL` and no WITH CHECK, with the comment:
--
--     "No WITH CHECK so we don't trap the soft-delete itself."
--
-- That is exactly backwards. Per the CREATE POLICY docs: "If no WITH CHECK
-- expression is defined, then the USING expression will be used both to
-- determine which rows are visible (normal USING case) and which new rows
-- will be allowed to be added (WITH CHECK case)."
--
-- So omitting WITH CHECK does not skip the check — it copies the USING
-- expression into it. The soft-delete then fails by construction: USING
-- passes because the OLD row has deleted_at IS NULL, and the copied WITH
-- CHECK immediately rejects the NEW row for having deleted_at set. It is not
-- intermittent; the write can never succeed. It looked rare only because
-- deleting a trip is rare (2 error events, 1 user). The 14 rows that do carry
-- deleted_at were all written by the service role, which bypasses RLS.
--
-- FIX
-- State WITH CHECK explicitly as the USING clause MINUS the deleted_at
-- conjunct. That is the whole delta.
--
-- What is deliberately preserved:
--   * USING is untouched, so a tombstoned row stays frozen — it cannot be
--     edited and, because deleted_at IS NULL fails on the OLD row, it cannot
--     be un-deleted either. Soft delete remains one-way.
--   * WITH CHECK still requires the NEW row to be owned by the caller (or the
--     caller to be an editor), so a trip cannot be handed to another user.
--   * The editor branch does not constrain user_id, so an editor collaborator
--     can still reassign ownership. That is pre-existing behaviour, identical
--     under the old implicit WITH CHECK, and is left alone rather than
--     silently widened or narrowed by a bug fix.

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
  )
  WITH CHECK (
    -- No deleted_at predicate here, and that omission is the entire point:
    -- this is what lets `SET deleted_at = now()` through. Re-adding it
    -- reintroduces the bug.
    (user_id = (SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM trip_collaborators
      WHERE trip_collaborators.trip_id = trips.id
        AND trip_collaborators.user_id = (SELECT auth.uid())
        AND trip_collaborators.role = 'editor'
    )
  );
