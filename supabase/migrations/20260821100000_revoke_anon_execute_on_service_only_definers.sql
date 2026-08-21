-- Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions that
-- only the service client ever calls.
--
-- FOUND BY: running tenant-guard (FedericoTs/tenant-guard) against this repo.
-- Its definer-grants guard flagged attach_referral_on_signup as a SECURITY
-- DEFINER function that mutates while EXECUTE is still held via PUBLIC. That is
-- correct: it inserts referral_events, stamps users.referred_by_code, bumps
-- counters and awards bananas.
--
-- It was NOT exploitable — the body's first statement is
--   IF (SELECT auth.role()) <> 'service_role' THEN RAISE EXCEPTION 'forbidden'
-- so an anon/authenticated caller is rejected before anything mutates. But
-- guarding inside the body while every role still holds EXECUTE is precisely
-- the belt-and-suspenders gap the guard exists to close: the grant layer should
-- say no first. All four callers use the admin (service_role) client
-- (referral/attach, trips/duplicate, auth/callback x2), so nothing legitimate
-- loses access.
--
-- ADJACENT, same shape, not separately flagged: get_page_views_by_country and
-- get_page_views_by_city are SECURITY DEFINER analytics aggregates read only by
-- /api/admin/stats via the service client. Anon had no reason to hold EXECUTE
-- on them either.
--
-- IMPORTANT — why this list is SHORT. The DB has ~13 anon-executable SECURITY
-- DEFINER functions. Most are RLS PREDICATES (user_can_access_trip,
-- user_is_trip_owner, user_can_vote, user_is_trip_collaborator, ...) called
-- from inside RLS policies whose role is `public`. Postgres requires the
-- CALLING role to hold EXECUTE even for a SECURITY DEFINER function invoked
-- inside a policy, so revoking their EXECUTE from anon BREAKS anon's RLS
-- evaluation. Proven in a rolled-back transaction:
--
--   revoke execute on user_can_access_trip from public, anon;
--   set role anon; select count(*) from activity_votes;
--   -> ERROR 42501: permission denied for function user_can_access_trip
--
-- tenant-guard flagged user_is_trip_owner (an RLS predicate) for revocation;
-- following that on any of these predicates would be an outage, not a fix. Only
-- functions that are BOTH service-only AND not referenced by any RLS policy are
-- safe to lock down, which is exactly the three below. The invite-preview RPCs
-- (get_invite_by_token, get_invite_status_by_token) are deliberately anon and
-- stay as-is.
--
-- REVOKE FROM PUBLIC, not just anon: the grant is held via PUBLIC, so
-- "revoke ... from anon" alone is a no-op. service_role keeps EXECUTE.

revoke execute on function public.attach_referral_on_signup(uuid, text)   from public, anon, authenticated;
revoke execute on function public.get_page_views_by_country()             from public, anon, authenticated;
revoke execute on function public.get_page_views_by_city()                from public, anon, authenticated;

notify pgrst, 'reload schema';
