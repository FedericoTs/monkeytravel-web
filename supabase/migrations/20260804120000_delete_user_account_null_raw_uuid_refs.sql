-- ============================================================================
-- GDPR: finish account deletion — null the 4 raw auth.users references
-- ============================================================================
-- 2026-08-04. delete_user_account() cleared exactly four tables (trips,
-- ai_usage, user_tester_access, users). Fourteen tables carry a column
-- REFERENCING auth.users(id); ten of them were untouched by the RPC.
--
-- Six use ON DELETE SET NULL (funnel_events, hostelworld_clicks,
-- trip_expenses, trip_reports, user_feedback, wizard_step_events). Those
-- self-anonymise when the auth row goes and are accepted as erased —
-- product decision, 2026-08-04.
--
-- The remaining FOUR declare no ON DELETE clause at all, so Postgres applies
-- NO ACTION:
--
--   trip_invites.created_by
--   trip_collaborators.invited_by
--   activity_proposals.resolved_by
--   mcp_itineraries.claimed_by
--
-- This is not merely "data left behind". NO ACTION means the reference
-- BLOCKS the delete. app/api/profile/delete runs in two phases: the RPC
-- (public schema), then adminClient.auth.admin.deleteUser() (auth schema).
-- For any user whose id sits in one of these four columns, phase 2 raises a
-- foreign-key violation and the route returns its own worst-case branch:
--
--   "Account data deleted but auth record removal failed. Contact support."
--
-- Which is a half-deleted account — trips destroyed, email still sitting in
-- auth.users. A user who asked to be forgotten is left more exposed than
-- before, not less.
--
-- WHY NULL AND NOT DELETE. These columns record who performed an action on
-- a trip that may belong to SOMEBODY ELSE and still have live members.
-- Deleting the row would revoke a working invite or drop a collaborator from
-- another user's trip — erasing a third party's data to satisfy this user's
-- request. Nulling removes the personal identifier, which is what erasure
-- requires, and leaves the other party's trip intact.
--
-- Ordering matters: the nulls run BEFORE the users/auth delete, so the FK is
-- already clear by the time phase 2 fires.
--
-- Body reproduced verbatim from 20260610000000_secdef_authz_guards.sql with
-- ONLY the four UPDATEs added. The service-role guard is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Erase the identifier from actions recorded against other people's
  -- trips, and clear the NO ACTION references that would otherwise block
  -- auth.admin.deleteUser() in phase 2 of app/api/profile/delete.
  UPDATE public.trip_invites       SET created_by  = NULL WHERE created_by  = p_user_id;
  UPDATE public.trip_collaborators SET invited_by  = NULL WHERE invited_by  = p_user_id;
  UPDATE public.activity_proposals SET resolved_by = NULL WHERE resolved_by = p_user_id;
  UPDATE public.mcp_itineraries    SET claimed_by  = NULL WHERE claimed_by  = p_user_id;

  DELETE FROM public.trips WHERE user_id = p_user_id;
  DELETE FROM public.ai_usage WHERE user_id = p_user_id;
  DELETE FROM public.user_tester_access WHERE user_id = p_user_id;
  DELETE FROM public.users WHERE id = p_user_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Backfill: users already half-deleted by the bug above.
--
-- Any row in these four tables whose uuid no longer resolves in auth.users
-- is a leftover from a deletion that partially succeeded. Nulling them is
-- the same erasure the RPC now performs, applied retroactively. Safe to
-- re-run; matches nothing once clean.
-- ----------------------------------------------------------------------------

UPDATE public.trip_invites ti SET created_by = NULL
 WHERE created_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ti.created_by);

UPDATE public.trip_collaborators tc SET invited_by = NULL
 WHERE invited_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = tc.invited_by);

UPDATE public.activity_proposals ap SET resolved_by = NULL
 WHERE resolved_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ap.resolved_by);

UPDATE public.mcp_itineraries mi SET claimed_by = NULL
 WHERE claimed_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = mi.claimed_by);
