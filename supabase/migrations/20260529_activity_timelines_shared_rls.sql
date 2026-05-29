-- Migration: Activity timelines are SHARED per trip, not per-user (Task #183)
--
-- Background
-- ----------
-- The original activity_timelines table shipped with a single ALL-policy:
--   CREATE POLICY "Users can manage their own activity timelines"
--     ON activity_timelines FOR ALL USING (auth.uid() = user_id);
--
-- That policy assumes timelines are per-user. In practice they're written
-- with user_id = trip-owner (see the upsert in
-- app/api/trips/[id]/activities/[activityId]/route.ts PATCH — onConflict
-- "trip_id,activity_id,user_id" using the caller's id, which is always
-- the trip owner because the same route also calls verifyTripOwnership).
--
-- So every trip has exactly one timeline-set, owned by the trip owner.
-- Collaborators can pass verifyTripAccess in the API layer but then hit
-- the RLS policy and get back zero rows — live-tracking is silently
-- broken for any collaborator (the entire point of collaborative trips).
--
-- Data audit on prod confirms one user_id per trip, and that user_id is
-- always the trip owner:
--   SELECT at.trip_id, at.user_id, t.user_id, (at.user_id = t.user_id)
--   FROM activity_timelines at JOIN trips t ON t.id = at.trip_id
--   GROUP BY at.trip_id, at.user_id, t.user_id;
--   -> every row has is_owner = true.
--
-- Replacement strategy: treat timelines as a shared resource per trip.
-- ------------------------------------------------------------------
-- 1. SELECT: trip owner OR any collaborator (any role — voters and
--    viewers should be able to *see* live progress even if they can't
--    change it).
-- 2. INSERT / UPDATE / DELETE: trip owner only. The API layer still
--    enforces verifyTripOwnership on PATCH, but we belt-and-suspenders
--    it here. Editors don't get write access to timelines in this
--    iteration — keep the writer surface minimal until product asks
--    for it. (If/when that changes, swap user_is_trip_owner for a
--    "owner OR editor" check via a new helper.)
--
-- We reuse the existing SECURITY DEFINER helpers added in
-- 20260529_tighten_trip_collaborators_rls.sql:
--   public.user_is_trip_owner(p_trip_id uuid, p_user_id uuid)
--   public.user_is_trip_collaborator(p_trip_id uuid, p_user_id uuid)
-- to avoid recursive RLS evaluation against trips/trip_collaborators.

-- =====================================================
-- 1. Drop the over-narrow ALL policy
-- =====================================================

DROP POLICY IF EXISTS "Users can manage their own activity timelines"
  ON public.activity_timelines;

-- =====================================================
-- 2. SELECT: trip owner OR any collaborator
-- =====================================================

CREATE POLICY "Trip owner or collaborator can view activity timelines"
  ON public.activity_timelines
  FOR SELECT
  USING (
    public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
    OR public.user_is_trip_collaborator(trip_id, (SELECT auth.uid()))
  );

-- =====================================================
-- 3. INSERT / UPDATE / DELETE: trip owner only
-- =====================================================
-- Three separate policies (one per command) rather than a single FOR ALL
-- because the SELECT predicate above is more permissive than the write
-- predicate here — Postgres OR-combines permissive policies per command,
-- so keeping them split makes the intent explicit.

CREATE POLICY "Trip owner can insert activity timelines"
  ON public.activity_timelines
  FOR INSERT
  WITH CHECK (
    public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
  );

CREATE POLICY "Trip owner can update activity timelines"
  ON public.activity_timelines
  FOR UPDATE
  USING (
    public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
  );

CREATE POLICY "Trip owner can delete activity timelines"
  ON public.activity_timelines
  FOR DELETE
  USING (
    public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
  );
