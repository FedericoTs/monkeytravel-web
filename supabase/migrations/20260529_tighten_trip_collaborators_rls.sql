-- Migration: Tighten trip_collaborators RLS (Task #171, P0 SECURITY)
--
-- Background
-- ----------
-- The original 20251220_create_trip_collaboration.sql shipped with
--   CREATE POLICY "Authenticated users can view collaborators" ON trip_collaborators
--     FOR SELECT USING (auth.uid() IS NOT NULL);
-- meaning any logged-in user could `SELECT * FROM trip_collaborators` and
-- walk away with the entire collaboration graph (every (trip_id, user_id,
-- role) edge across the whole product). That's the social graph of the
-- platform leaking to anyone with an anon key + a session.
--
-- The migration's own comment explained why the policy was so loose:
-- a "user is a collaborator on the same trip" predicate self-references
-- trip_collaborators inside its own USING clause and recurses. The
-- safer pattern Supabase recommends is a SECURITY DEFINER helper
-- function — which we already use for the sibling check
-- `public.user_is_trip_owner(p_trip_id, p_user_id)` — so we follow that
-- precedent here and add `public.user_is_trip_collaborator(...)`.
--
-- Replacement strategy
-- --------------------
-- 1. Add `public.user_is_trip_collaborator(p_trip_id, p_user_id)` as a
--    STABLE SECURITY DEFINER function. RLS is bypassed inside the
--    function body, so the "is the caller on the same trip?" check no
--    longer recurses.
-- 2. Drop the over-broad SELECT policy.
-- 3. Add three scoped SELECT policies (combined with OR — Postgres
--    union semantics for permissive policies):
--      a. "Collaborator can view their own rows"
--           USING (user_id = auth.uid())
--      b. "Trip owner can view all collaborators on their trip"
--           USING (public.user_is_trip_owner(trip_id, auth.uid()))
--      c. "Collaborator can view co-collaborators on shared trip"
--           USING (public.user_is_trip_collaborator(trip_id, auth.uid()))
-- 4. No anonymous SELECT — all three predicates require auth.uid().
--    Anonymous flows (invite preview page, invite-accept route) already
--    use `supabaseAdmin` (service role) which bypasses RLS, so they
--    keep working without policy changes.
--
-- Callers verified (every `.from('trip_collaborators').select(...)` in
-- the codebase):
--   - lib/api/auth.ts (verifyTripAccess)                       → self-row    → (a)
--   - app/[locale]/trips/[id]/page.tsx (self-collab check)     → self-row    → (a)
--   - app/[locale]/trips/[id]/page.tsx (count for quorum)      → any collab  → (b)+(c)
--   - app/api/trips/[id]/votes/route.ts (voter weights)        → any collab  → (b)+(c)
--   - app/api/trips/[id]/proposals/route.ts (voter weights)    → any collab  → (b)+(c)
--   - app/api/trips/[id]/proposals/[proposalId]/route.ts       → any collab  → (b)+(c)
--   - app/api/trips/[id]/proposals/[proposalId]/vote/route.ts  → mixed       → (a)+(b)+(c)
--   - app/api/trips/[id]/collaborators/route.ts (list all)     → any collab  → (b)+(c)
--   - app/api/trips/[id]/collaborators/[userId]/route.ts       → self-role   → (a)
--   - app/api/trips/[id]/activities/[activityId]/vote/route.ts → self-role   → (a)
--   - app/[locale]/invite/[token]/page.tsx                     → service role → RLS bypassed
--   - app/api/invites/[token]/route.ts                         → service role → RLS bypassed
--
-- Known follow-up (out of scope, separate task):
--   - app/api/admin/growth/route.ts uses getAuthenticatedAdmin() which
--     returns the SSR (RLS-enforced) client, NOT a service-role client.
--     After this migration the admin growth dashboard's
--     "collaboratorsResult" will be scoped to the admin user's own
--     trips + trips where they collaborate, which under-reports the
--     global collaboration metric. That route should be migrated to a
--     service-role client. Filed as separate task.

-- =====================================================
-- 1. SECURITY DEFINER helper — sibling of user_is_trip_owner
-- =====================================================

CREATE OR REPLACE FUNCTION public.user_is_trip_collaborator(
  p_trip_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_collaborators
    WHERE trip_id = p_trip_id
      AND user_id = p_user_id
  );
$$;

COMMENT ON FUNCTION public.user_is_trip_collaborator(uuid, uuid) IS
  'Returns true if p_user_id is a collaborator on p_trip_id. SECURITY '
  'DEFINER so it can be referenced from trip_collaborators RLS policies '
  'without triggering self-referential RLS recursion. See task #171.';

-- Lock down the function — only authenticated users should ever need
-- this check from a policy. Revoke the default PUBLIC grant first.
REVOKE ALL ON FUNCTION public.user_is_trip_collaborator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_trip_collaborator(uuid, uuid) TO authenticated;

-- =====================================================
-- 2. Drop the over-broad SELECT policy
-- =====================================================

DROP POLICY IF EXISTS "Authenticated users can view collaborators" ON public.trip_collaborators;

-- =====================================================
-- 3. Add scoped SELECT policies (a + b + c, OR-combined)
-- =====================================================

-- (a) Each collaborator can read their own row. Self-only — even if
-- the trip owner later revokes them, they can still see they were
-- removed (the row would already be gone).
CREATE POLICY "Collaborator can view their own rows"
  ON public.trip_collaborators
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- (b) Trip owner can read every collaborator row for trips they own.
-- Reuses the existing helper used by the sibling DELETE/UPDATE/INSERT
-- policies, so the predicate tree is consistent across the table.
CREATE POLICY "Trip owner can view all collaborators on their trip"
  ON public.trip_collaborators
  FOR SELECT
  TO authenticated
  USING (public.user_is_trip_owner(trip_id, (SELECT auth.uid())));

-- (c) Any collaborator on a trip can see their co-collaborators on
-- the SAME trip (no cross-trip leak). Needed for: trip-detail page's
-- quorum count, votes route, proposals routes, collaborators list
-- route (avatar bundles in the invite-management UI).
CREATE POLICY "Collaborator can view co-collaborators on shared trip"
  ON public.trip_collaborators
  FOR SELECT
  TO authenticated
  USING (public.user_is_trip_collaborator(trip_id, (SELECT auth.uid())));
