-- Migration: Lock down trip_invites RLS (Task #170, P0 SECURITY)
--
-- Background
-- ----------
-- The original 20251220_create_trip_collaboration.sql shipped with
--   CREATE POLICY "Anyone can view invites" ON trip_invites FOR SELECT USING (true);
-- meaning any client holding the anon key could `SELECT * FROM trip_invites`
-- and walk away with every token in the table — instant takeover of every
-- collaborative trip as editor/voter/viewer.
--
-- A subsequent migration also added a near-duplicate policy named
-- "Anyone can view invites by token" with the same `USING (true)` predicate.
-- Both must die.
--
-- Replacement strategy
-- --------------------
-- 1. Drop the two public-read policies.
-- 2. Keep the existing "Owners and editors can view invites" policy so
--    authenticated trip owners / editors can still list and manage their
--    own trip's invites via direct .from('trip_invites').select().
-- 3. Expose a SECURITY DEFINER RPC `get_invite_by_token(p_token text)`
--    that returns at most one row matching the token AND only when the
--    invite is still usable (is_active = true, expires_at > now(),
--    max_uses not yet exhausted). Anonymous callers go through this RPC
--    instead of reading the table directly.
--
-- Note on the column name: the brief mentioned `revoked_at IS NULL` but
-- the actual schema uses a boolean `is_active` (true = live, false =
-- revoked / soft-deleted). We honor the intent by gating on is_active.

-- =====================================================
-- 1. Drop the public-read policies
-- =====================================================

DROP POLICY IF EXISTS "Anyone can view invites" ON public.trip_invites;
DROP POLICY IF EXISTS "Anyone can view invites by token" ON public.trip_invites;

-- =====================================================
-- 2. SECURITY DEFINER RPC for anonymous lookup by token
-- =====================================================
-- Returns at most one row. Only returns invites that are STILL USABLE
-- (active, not expired, not exhausted) — callers see the same NOT_FOUND
-- experience for "doesn't exist", "revoked", "expired", and "used up".
-- That's stricter than the previous behaviour (which returned the row
-- and let app code decide), but it's also the safer default for an
-- anonymous lookup. The validateInvite() helper in app code remains
-- a belt-and-suspenders check after the RPC returns.

CREATE OR REPLACE FUNCTION public.get_invite_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  trip_id uuid,
  token text,
  role text,
  created_by uuid,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  use_count integer,
  is_active boolean,
  is_referral_eligible boolean,
  recipient_email text,
  recipient_locale text,
  message text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    ti.id,
    ti.trip_id,
    ti.token,
    ti.role,
    ti.created_by,
    ti.created_at,
    ti.expires_at,
    ti.max_uses,
    ti.use_count,
    ti.is_active,
    ti.is_referral_eligible,
    ti.recipient_email,
    ti.recipient_locale,
    ti.message
  FROM public.trip_invites ti
  WHERE ti.token = p_token
    AND ti.is_active = true
    AND ti.expires_at > now()
    AND (ti.max_uses <= 0 OR ti.use_count < ti.max_uses)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_invite_by_token(text) IS
  'Anonymous-safe lookup of a single invite by token. Returns at most one '
  'row, and only if the invite is still usable (active, not expired, not '
  'exhausted). Replaces the previous USING (true) SELECT policy that let '
  'anon clients dump the entire trip_invites table. See task #170.';

-- Lock down the function: revoke the default PUBLIC grant first so we
-- can hand out exactly the privileges we want.
REVOKE ALL ON FUNCTION public.get_invite_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon, authenticated;
