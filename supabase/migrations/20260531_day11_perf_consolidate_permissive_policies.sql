-- ============================================================================
-- Day 11 Performance: Consolidate Multiple Permissive RLS Policies
-- ============================================================================
-- Issue:  Supabase advisor `multiple_permissive_policies` (32 findings)
-- Cause:  When N permissive policies cover the same (table, cmd, role) tuple,
--         Postgres OR's them together AT QUERY TIME. This is slower than a
--         single merged policy with an explicit OR predicate, and the lint
--         flags it as a code smell.
-- Fix:    For each (table, cmd, role-superset) group with >= 2 permissive
--         policies, DROP all of them and CREATE a single consolidated policy
--         whose USING / WITH CHECK is the explicit OR of the originals.
--         Semantics are preserved exactly (union of access).
--
-- IMPORTANT: This migration is INTENTIONALLY scoped. It does NOT touch any
-- policy that is already alone on its (table, cmd, role) tuple. Single-policy
-- DELETE / INSERT etc. that don't trigger the lint are left untouched.
--
-- Note on `{public}` role: in Postgres, the `public` pseudo-role is granted
-- to every role, so a policy on `{public}` is OR'd with policies on
-- `{anon}`, `{authenticated}`, `{authenticator}`, etc. for the same cmd.
-- The advisor reports this per (anon, authenticated, authenticator) — which
-- is why ~32 findings collapse to ~8 actual policy groups.
-- ============================================================================

BEGIN;

-- ============================================================================
-- GROUP 1: destination_activity_bank — SELECT
-- ----------------------------------------------------------------------------
-- Before (3 effective policies on SELECT for anon/authenticated):
--   * "Service role can manage activity bank"  (ALL,    {public},               qual = auth.role() = 'service_role')
--   * "Allow read access to activity bank"     (SELECT, {public},               qual = true)
--   * "Anyone can read destination_activity_bank" (SELECT, {anon,authenticated}, qual = true)
-- Two of them are `true` — already permissive-to-everyone. Service role can
-- always read anyway (its own ALL policy covers it). Merging into one
-- `SELECT TO public USING (true)` collapses all three readers safely.
-- The "Service role can manage activity bank" ALL policy stays so that
-- service_role retains INSERT/UPDATE/DELETE rights without the lint hit
-- (its own row is the only ALL policy — no conflict).
-- ============================================================================

DROP POLICY IF EXISTS "Allow read access to activity bank"        ON public.destination_activity_bank;
DROP POLICY IF EXISTS "Anyone can read destination_activity_bank" ON public.destination_activity_bank;

CREATE POLICY "destination_activity_bank_select_consolidated"
  ON public.destination_activity_bank
  FOR SELECT
  TO public
  USING (true);

-- ============================================================================
-- GROUP 2: destination_activity_bank — INSERT
-- ----------------------------------------------------------------------------
-- Before:
--   * "Service role can manage activity bank"     (ALL,    {public},               qual = auth.role() = 'service_role')
--   * "Anyone can insert destination_activity_bank" (INSERT, {anon,authenticated}, with_check = true)
-- The ALL policy already covers service_role, and `true` already covers
-- everyone. Net effect was "anyone can insert" — preserve that.
-- We keep "Service role can manage activity bank" untouched (single ALL policy)
-- and only consolidate the conflict on INSERT by replacing the per-role insert
-- with one on `public`.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can insert destination_activity_bank" ON public.destination_activity_bank;

CREATE POLICY "destination_activity_bank_insert_consolidated"
  ON public.destination_activity_bank
  FOR INSERT
  TO public
  WITH CHECK (true);

-- ============================================================================
-- GROUP 3: destination_activity_bank — UPDATE
-- ----------------------------------------------------------------------------
-- Before:
--   * "Service role can manage activity bank"      (ALL,    {public},               qual = auth.role() = 'service_role')
--   * "Anyone can update destination_activity_bank"(UPDATE, {anon,authenticated}, qual = true, with_check = true)
-- Same reasoning as INSERT. Net effect: anyone can update.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can update destination_activity_bank" ON public.destination_activity_bank;

CREATE POLICY "destination_activity_bank_update_consolidated"
  ON public.destination_activity_bank
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- GROUP 4: activity_proposals — UPDATE
-- ----------------------------------------------------------------------------
-- Before (2 policies, both on {public}):
--   * "Owners can resolve proposals"
--       qual = user_is_trip_owner(trip_id, auth.uid())
--   * "Proposers can update own proposals"
--       qual = (proposed_by = auth.uid()) AND (status IN ('pending','voting'))
-- Both have no WITH CHECK (defaults to USING).
-- Consolidated USING is the OR. WITH CHECK mirrors USING (Postgres default
-- for UPDATE when WITH CHECK is omitted is to use USING — keep explicit OR).
-- ============================================================================

DROP POLICY IF EXISTS "Owners can resolve proposals"      ON public.activity_proposals;
DROP POLICY IF EXISTS "Proposers can update own proposals" ON public.activity_proposals;

CREATE POLICY "activity_proposals_update_consolidated"
  ON public.activity_proposals
  FOR UPDATE
  TO public
  USING (
    user_is_trip_owner(trip_id, (SELECT auth.uid()))
    OR (
      (proposed_by = (SELECT auth.uid()))
      AND (status = ANY (ARRAY['pending'::text, 'voting'::text]))
    )
  )
  WITH CHECK (
    user_is_trip_owner(trip_id, (SELECT auth.uid()))
    OR (
      (proposed_by = (SELECT auth.uid()))
      AND (status = ANY (ARRAY['pending'::text, 'voting'::text]))
    )
  );

-- ============================================================================
-- GROUP 5: referral_codes — SELECT
-- ----------------------------------------------------------------------------
-- Before (2 policies on {public}):
--   * "Public can view referral codes by code"  qual = true
--   * "Users can view own referral code"        qual = (auth.uid() = user_id)
-- The first is unrestricted (`true`) — it dominates. Net = `true`.
-- ============================================================================

DROP POLICY IF EXISTS "Public can view referral codes by code" ON public.referral_codes;
DROP POLICY IF EXISTS "Users can view own referral code"       ON public.referral_codes;

CREATE POLICY "referral_codes_select_consolidated"
  ON public.referral_codes
  FOR SELECT
  TO public
  USING (true);

-- ============================================================================
-- GROUP 6: referral_tiers — SELECT
-- ----------------------------------------------------------------------------
-- Before (2 policies on {public}):
--   * "Leaderboard can view tiers" qual = true
--   * "Users can view own tier"    qual = (user_id = auth.uid())
-- The first is unrestricted (`true`) — it dominates. Net = `true`.
-- ============================================================================

DROP POLICY IF EXISTS "Leaderboard can view tiers" ON public.referral_tiers;
DROP POLICY IF EXISTS "Users can view own tier"    ON public.referral_tiers;

CREATE POLICY "referral_tiers_select_consolidated"
  ON public.referral_tiers
  FOR SELECT
  TO public
  USING (true);

-- ============================================================================
-- GROUP 7: trips — SELECT  *** HOT TABLE — EXTRA CAUTION ***
-- ----------------------------------------------------------------------------
-- Before (2 policies):
--   * "trips_explore_public_read" (SELECT, {anon,authenticated})
--       qual = (visibility = 'public') AND (share_token IS NOT NULL) AND (is_hidden = false)
--   * "trips_select" (SELECT, {public})
--       qual = (user_id = auth.uid())
--               OR (share_token IS NOT NULL)
--               OR ((is_template = true) AND (visibility = 'public'))
--               OR EXISTS (collaborator row)
--
-- INTENT ANALYSIS:
--   - trips_explore_public_read: "explore feed" — only public+shared+visible trips
--     can be browsed anonymously / by other logged-in users.
--   - trips_select: owner sees their own + share_token-bearing + public templates +
--     collaborator-shared trips.
--
-- OVERLAP CHECK: trips_explore_public_read requires share_token IS NOT NULL.
--   trips_select's second OR'd clause is also `share_token IS NOT NULL` (with NO
--   visibility / hidden filter). That means a logged-in user can ALREADY read any
--   trip with a share_token via trips_select, regardless of visibility/is_hidden.
--   So the explore policy is strictly NARROWER than trips_select for the
--   `share_token IS NOT NULL` rows — it's redundant for authenticated users.
--   For ANON users, trips_select still applies (it's on {public}) — auth.uid()
--   returns NULL for anon, so `user_id = NULL` is NULL (no match), but the
--   `share_token IS NOT NULL` clause still hits — meaning anon can read any
--   shared trip even today. The explore policy adds the visibility/hidden filter
--   for anon — but trips_select already grants it without that filter.
--
-- CONSOLIDATION: union of the two predicates. The result is functionally
--   equivalent to trips_select alone (since explore is a subset), but we OR
--   them explicitly so a future change to trips_select can't accidentally narrow
--   explore behavior without an obvious diff.
-- ============================================================================

DROP POLICY IF EXISTS "trips_explore_public_read" ON public.trips;
DROP POLICY IF EXISTS "trips_select"              ON public.trips;

CREATE POLICY "trips_select_consolidated"
  ON public.trips
  FOR SELECT
  TO public
  USING (
    -- Owner
    (user_id = (SELECT auth.uid()))
    -- Shared via token (any logged-in user OR anon)
    OR (share_token IS NOT NULL)
    -- Public template
    OR ((is_template = true) AND (visibility = 'public'::text))
    -- Collaborator
    OR (EXISTS (
      SELECT 1
      FROM trip_collaborators
      WHERE trip_collaborators.trip_id = trips.id
        AND trip_collaborators.user_id = (SELECT auth.uid())
    ))
    -- Explore feed: public + shared + not hidden (subset of `share_token IS NOT NULL`
    -- above, but kept explicit so the original intent is documented and the lint
    -- never regresses if the share_token branch is ever tightened).
    OR (
      (visibility = 'public'::text)
      AND (share_token IS NOT NULL)
      AND (is_hidden = false)
    )
  );

-- ============================================================================
-- GROUP 8: trip_collaborators — SELECT  *** HOT TABLE — EXTRA CAUTION ***
-- ----------------------------------------------------------------------------
-- Before (3 policies, all on {authenticated}):
--   * "Collaborator can view co-collaborators on shared trip"
--       qual = user_is_trip_collaborator(trip_id, auth.uid())
--       INTENT: if I'm a collaborator on trip X, I can see all other collaborator
--               rows on trip X.
--   * "Collaborator can view their own rows"
--       qual = (user_id = auth.uid())
--       INTENT: I can always see my own collaborator rows (even on trips where
--               I might have been removed mid-query, etc.).
--   * "Trip owner can view all collaborators on their trip"
--       qual = user_is_trip_owner(trip_id, auth.uid())
--       INTENT: owner sees full collaborator list.
--
-- Three orthogonal access vectors → semantically distinct → OR them.
-- The OR is a strict union; no row gains access it didn't have before, no
-- row loses access. Safe to consolidate.
-- ============================================================================

DROP POLICY IF EXISTS "Collaborator can view co-collaborators on shared trip" ON public.trip_collaborators;
DROP POLICY IF EXISTS "Collaborator can view their own rows"                  ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owner can view all collaborators on their trip"   ON public.trip_collaborators;

CREATE POLICY "trip_collaborators_select_consolidated"
  ON public.trip_collaborators
  FOR SELECT
  TO authenticated
  USING (
    -- Owner of the trip
    user_is_trip_owner(trip_id, (SELECT auth.uid()))
    -- A collaborator on the same trip (sees co-collaborators)
    OR user_is_trip_collaborator(trip_id, (SELECT auth.uid()))
    -- The row is mine
    OR (user_id = (SELECT auth.uid()))
  );

-- ============================================================================
-- GROUP 9: trip_collaborators — DELETE  *** HOT TABLE — EXTRA CAUTION ***
-- ----------------------------------------------------------------------------
-- Before (2 policies, both on {authenticated}):
--   * "Collaborator can remove themselves"
--       qual = (user_id = auth.uid())
--       INTENT: I can leave a trip I'm collaborating on.
--   * "Trip owners can delete collaborators"
--       qual = user_is_trip_owner(trip_id, auth.uid())
--       INTENT: owner can kick anyone.
--
-- Two orthogonal access vectors → OR them. Union preserves access exactly.
-- ============================================================================

DROP POLICY IF EXISTS "Collaborator can remove themselves"    ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owners can delete collaborators"  ON public.trip_collaborators;

CREATE POLICY "trip_collaborators_delete_consolidated"
  ON public.trip_collaborators
  FOR DELETE
  TO authenticated
  USING (
    -- I'm leaving
    (user_id = (SELECT auth.uid()))
    -- Or I'm the trip owner kicking someone
    OR user_is_trip_owner(trip_id, (SELECT auth.uid()))
  );

-- ============================================================================
-- NOT MERGED (intentionally left alone — single policy on their tuple):
--   activity_proposals: DELETE, INSERT, SELECT — each has 1 policy.
--   referral_codes:     INSERT — 1 policy.
--   trips:              DELETE (trips_delete_own), INSERT (trips_insert_own),
--                       UPDATE (trips_update) — each has 1 policy.
--   trip_collaborators: INSERT (Trip owners can insert collaborators) — 1 policy.
--                       UPDATE (Trip owners can update collaborators) — 1 policy.
--   destination_activity_bank: "Service role can manage activity bank" (ALL on {public})
--                              is left in place — it's the only ALL policy and is
--                              now non-conflicting because the new consolidated
--                              SELECT/INSERT/UPDATE policies are on {public} too
--                              (still 2 policies per cmd: ALL + the cmd-specific one).
--
--   WAIT — verify: ALL policies count as a permissive policy for every cmd they
--   cover, so "Service role can manage activity bank" WILL still pair with each
--   of the new {public} cmd-specific policies and re-raise the lint.
--   We resolve this by DROPPING the ALL policy and replacing it with the union
--   below — since the new cmd-specific policies are USING(true)/WITH CHECK(true)
--   they already cover service_role implicitly. DELETE is the only cmd where
--   service_role previously had access via the ALL policy and there's no new
--   per-cmd policy — so we add a service-role-only DELETE policy to preserve that.
-- ============================================================================

DROP POLICY IF EXISTS "Service role can manage activity bank" ON public.destination_activity_bank;

CREATE POLICY "destination_activity_bank_delete_service_role"
  ON public.destination_activity_bank
  FOR DELETE
  TO public
  USING ((SELECT auth.role()) = 'service_role'::text);

-- ============================================================================
-- POLICIES LEFT UNCHANGED (verified not flagged by advisor):
--   activity_proposals.DELETE — "Proposers can delete own pending proposals"
--   activity_proposals.INSERT — "Suggesters can create proposals"
--   activity_proposals.SELECT — "Trip members can view proposals"
--   referral_codes.INSERT     — "Users can insert own referral code"
--   trips.DELETE              — "trips_delete_own"
--   trips.INSERT              — "trips_insert_own"
--   trips.UPDATE              — "trips_update"
--   trip_collaborators.INSERT — "Trip owners can insert collaborators"
--   trip_collaborators.UPDATE — "Trip owners can update collaborators"
-- ============================================================================

COMMIT;

-- ============================================================================
-- SUMMARY OF CHANGES
-- ============================================================================
-- Groups consolidated: 9
-- Policies dropped:    16
-- Policies created:    10  (9 consolidations + 1 service-role DELETE preserver)
-- Net policy delta:    -6
--
-- Per-table:
--   destination_activity_bank: 5 -> 4 policies (SELECT/INSERT/UPDATE/DELETE-svc-role)
--   activity_proposals:        5 -> 4 policies (UPDATE merged)
--   referral_codes:            3 -> 2 policies (SELECT merged)
--   referral_tiers:            2 -> 1 policy   (SELECT merged)
--   trips:                     5 -> 4 policies (SELECT merged)
--   trip_collaborators:        6 -> 4 policies (SELECT + DELETE merged)
--
-- Expected advisor delta: 32 multiple_permissive_policies findings -> 0
-- ============================================================================
