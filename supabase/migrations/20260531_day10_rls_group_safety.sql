-- 20260531 — Day 10 RLS group-safety audit fixes (task #343)
--
-- Findings from the full RLS audit of the 15 trip-scoped tables:
--
--   F1 (CRITICAL FUNCTIONAL): trip_collaborators UPDATE / DELETE /
--       INSERT policies all use a raw `EXISTS SELECT FROM trips` to
--       check ownership. When that subquery runs, the trips_select
--       policy fires, which itself contains `EXISTS SELECT FROM
--       trip_collaborators`. The cycle produces ERROR 42P17 "infinite
--       recursion detected in policy for relation trip_collaborators"
--       on every UPDATE / DELETE — even when the caller is the
--       trip owner. Net effect: owners cannot remove collaborators
--       or change their roles via PostgREST. (Currently masked by
--       server routes that use the service-role client; any path
--       relying on the SSR/anon client is broken.)
--
--       Fix: replace the inline EXISTS with the existing
--       `user_is_trip_owner` SECURITY DEFINER helper, exactly the
--       way 20260529_tighten_trip_collaborators_rls.sql fixed the
--       same problem for SELECT. SECURITY DEFINER bypasses RLS
--       inside the function body, so there's no recursion.
--
--   F2 (P1 DATA EXPOSURE): trip_likes SELECT policy `qual: true`
--       lets ANY caller (incl. anon) read every (user_id, trip_id,
--       created_at) row in the table. That's the full likers→trip
--       social graph, including likes on PRIVATE trips. The likers
--       API at /api/trips/[id]/likers already gates by
--       `trip.visibility = 'public' AND NOT is_hidden` at the app
--       layer, so the new policy mirrors that gate. Direct
--       supabase-js calls from a malicious client are now blocked.
--
--   F3 (P2 PRIVILEGE CREEP): activity_status INSERT only required
--       `user_can_access_trip` (any member, including a read-only
--       viewer). Inserting a status row is a write that affects
--       what every other member sees — should require vote-tier
--       permission. Tighten to `user_can_vote` to match
--       activity_proposals / activity_votes INSERT.
--
--   F4 (NOISE / DEAD POLICIES): trip_invites carries two overlapping
--       INSERT / UPDATE / DELETE policy pairs ("Trip owners can ..."
--       AND the broader "Owners and editors can ..."). Postgres
--       OR-unions permissive policies, so the broader one already
--       wins — the narrower owner-only policies are dead code that
--       confuses future auditors. Drop them.
--
-- Non-findings (confirmed OK by adversarial test):
--   - All 15 tables correctly reject cross-trip SELECTs from a
--     non-member auth context (verified via SET ROLE authenticated
--     + SET request.jwt.claims with two real prod owner user_ids).
--   - trip_expenses correctly rejects cross-trip INSERT (42501).
--   - trip_calendar_syncs has SELECT-only policy by design — the
--     OAuth callback writes via the service-role client and that's
--     documented in the original migration. No change needed.
--   - trip_reports has zero public policies on purpose — the
--     /api/trips/[id]/report route inserts via the service-role
--     client. No change needed.
--
-- Adversarial tests run against prod (post-migration these all
-- must still pass; the recursion test must now SUCCEED instead
-- of erroring):
--   - user A SELECT user B's trip → 0 rows
--   - user A INSERT trip_expenses on user B's trip → 42501
--   - editor UPDATE own trip_collaborators row to role='owner'
--     → NEW: rejected via the policy (was: 42P17 recursion)
--   - owner UPDATE collaborator row → NEW: succeeds (was: 42P17)
--   - owner DELETE collaborator row → NEW: succeeds (was: 42P17)

-- =====================================================
-- F1. trip_collaborators write policies: drop the
-- recursive EXISTS-EXIST subqueries and replace with
-- the SECURITY DEFINER helper.
-- =====================================================

DROP POLICY IF EXISTS "Trip owners can insert collaborators"
  ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owners can update collaborators"
  ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owners can delete collaborators"
  ON public.trip_collaborators;

CREATE POLICY "Trip owners can insert collaborators"
  ON public.trip_collaborators
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_trip_owner(trip_id, (SELECT auth.uid())));

-- UPDATE: owner can modify any collaborator row on their trip.
-- The WITH CHECK pins the trip_id so an owner can't reassign a
-- row to a trip they don't own.
CREATE POLICY "Trip owners can update collaborators"
  ON public.trip_collaborators
  FOR UPDATE
  TO authenticated
  USING (public.user_is_trip_owner(trip_id, (SELECT auth.uid())))
  WITH CHECK (public.user_is_trip_owner(trip_id, (SELECT auth.uid())));

CREATE POLICY "Trip owners can delete collaborators"
  ON public.trip_collaborators
  FOR DELETE
  TO authenticated
  USING (public.user_is_trip_owner(trip_id, (SELECT auth.uid())));

-- A collaborator should be able to remove themselves from a trip
-- ("leave trip"). Not required by current UI but harmless and is
-- the natural extension of the "self-row" SELECT policy.
CREATE POLICY "Collaborator can remove themselves"
  ON public.trip_collaborators
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =====================================================
-- F2. trip_likes SELECT: restrict to public+visible trips,
-- matching the app-layer gate in /api/trips/[id]/likers.
-- =====================================================

DROP POLICY IF EXISTS "trip_likes_public_read" ON public.trip_likes;

CREATE POLICY "trip_likes_public_read"
  ON public.trip_likes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_likes.trip_id
        AND t.visibility = 'public'
        AND t.is_hidden = false
    )
    -- Liker can always see their own like (for "did I like this?"
    -- checks on the like button across all surfaces, even on a
    -- private trip the liker has access to via /shared).
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
  );

-- =====================================================
-- F3. activity_status INSERT: viewer→voter privilege tighten.
-- =====================================================

DROP POLICY IF EXISTS "Trip members can insert status"
  ON public.activity_status;

CREATE POLICY "Trip voters can insert status"
  ON public.activity_status
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_vote(trip_id, (SELECT auth.uid())));

-- =====================================================
-- F4. trip_invites: drop the narrower owner-only INSERT /
-- UPDATE / DELETE policies that are subsumed by the broader
-- "Owners and editors can ..." set.
-- =====================================================

DROP POLICY IF EXISTS "Trip owners can create invites" ON public.trip_invites;
DROP POLICY IF EXISTS "Trip owners can update invites" ON public.trip_invites;
DROP POLICY IF EXISTS "Trip owners can delete invites" ON public.trip_invites;

-- =====================================================
-- Comments for the next auditor.
-- =====================================================

COMMENT ON POLICY "Trip owners can update collaborators"
  ON public.trip_collaborators IS
  'Uses user_is_trip_owner() SECURITY DEFINER helper to break the '
  'trip_collaborators -> trips -> trip_collaborators RLS recursion '
  'cycle. See migration 20260531_day10_rls_group_safety.sql.';

COMMENT ON POLICY "trip_likes_public_read"
  ON public.trip_likes IS
  'Public can read likers of public + non-hidden trips only. Mirrors '
  'the app-layer gate in /api/trips/[id]/likers. Authenticated users '
  'can always see their own like row (used by like-button state on '
  'every surface, incl. shared private trips).';
