-- Migration: add_delete_user_account_rpc
-- Task #213 — /api/profile/delete: step-up auth + transactional cascade
--
-- Creates a SECURITY DEFINER RPC that deletes all public-schema user data
-- inside a single implicit transaction. Auth-schema cleanup
-- (auth.users.deleteUser) is still performed via the admin API in the
-- route handler, since that is a separate auth-schema operation.
--
-- The RPC scopes the delete to the supplied p_user_id only. The route
-- handler is responsible for verifying that the caller owns that user_id
-- via step-up password re-authentication BEFORE invoking this function.

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Order matters only when FKs are RESTRICT/NO ACTION. Most child FKs to
  -- trips and users are CASCADE, but we delete explicit tables defensively
  -- so behavior matches the previous route handler and stays predictable
  -- even if FK rules drift.

  -- Trips: child tables (activity_proposals, activity_reactions,
  -- activity_status, activity_timelines, activity_votes, ai_conversations,
  -- anonymous_activity_votes, trip_checklists, trip_collaborators,
  -- trip_invites, trip_likes, trip_reports, trip_saves, trip_views) all
  -- cascade on trips.id, so deleting trips cleans them up.
  DELETE FROM public.trips WHERE user_id = p_user_id;

  -- AI usage rows live independent of trips (trip_id is SET NULL on
  -- trips delete), so wipe by user_id explicitly.
  DELETE FROM public.ai_usage WHERE user_id = p_user_id;

  -- Tester / early-access grants.
  DELETE FROM public.user_tester_access WHERE user_id = p_user_id;

  -- Finally the user profile. Other CASCADE-on-users.id children
  -- (banana_redemptions, banana_transactions, proposal_votes,
  -- referral_codes, referral_tiers, etc.) clean up via FK.
  DELETE FROM public.users WHERE id = p_user_id;
END;
$$;

-- Only authenticated users can invoke; revoke from anon/public.
REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO service_role;

COMMENT ON FUNCTION public.delete_user_account(uuid) IS
  'Transactional cascade delete of a user account. Caller (route handler) MUST re-authenticate the user via step-up password check before invoking. Does NOT delete the auth.users row — that is handled separately via the admin API.';
