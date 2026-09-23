-- Close the ways to put a person on a trip, or a trip in a person's account,
-- without their consent. Safe to apply at merge time: every app path below
-- keeps working with the old code and the new.
--
-- Found 2026-09-23 after #175 (read-only; nothing here was exploited):
--
-- 1. accept_trip_invite(p_token, p_user_id) and claim_anonymous_trip(
--    p_claim_token, p_user_id) are SECURITY DEFINER and could be executed by
--    any signed-in user, and neither checks p_user_id against auth.uid().
--    Anyone holding an invite token could add ANY account to that trip
--    (skipping the route's recipient-email check), and anyone holding a
--    claim token could hand the anonymous trip to any account. Their only
--    callers, app/api/invites/[token] and app/api/trips/claim, use the
--    service role. Now service-role only.
--
-- 2. "Trip owners can insert collaborators" let an owner insert any user id
--    as a collaborator, straight through the API: the trip appears in the
--    victim's account. It was also the owner's first step to making
--    themselves an editor. The only user-client insert is the POST handler
--    of app/api/trips/[id]/collaborators, which nothing calls (it now
--    answers 410). Collaborators are added by accepting an invite.
--
-- 3. "Trip owners can update collaborators" limited rows but not columns,
--    and the role CHECK allows 'owner': an owner could move a collaborator
--    row to another trip, re-point it at another user, or make someone an
--    'owner'-role collaborator (which the API routes treat as privileged).
--    The only update, the PATCH role route, writes role alone, and sets
--    'owner' only on the caller's own row. Now: authenticated may update
--    the role column only, to editor / voter / viewer, or 'owner' on their
--    own row.
--
-- 4. trip_invites: the update policy had no column limit, so an owner or
--    editor could reset use_count, re-arm single-use and email invites,
--    clear recipient_email, or rewrite created_by / is_referral_eligible
--    (created_by is who the referral bananas are paid to). The only update
--    is the deactivate route ({ is_active: false }). Inserts could name any
--    created_by and any use_count / max_uses. Now: update is_active only;
--    inserts must be created_by the caller, start at use_count 0, and allow
--    1-100 uses (the route defaults to 1 and nothing sends more).
--
-- Rollback per item: re-grant, or recreate the old policy text from
-- supabase/rls-baseline.json.

revoke execute on function public.accept_trip_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_trip_invite(text, uuid) to service_role;

revoke execute on function public.claim_anonymous_trip(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_anonymous_trip(text, uuid) to service_role;

drop policy if exists "Trip owners can insert collaborators" on public.trip_collaborators;
revoke insert on public.trip_collaborators from public, anon, authenticated;

revoke update on public.trip_collaborators from public, anon, authenticated;
grant update (role) on public.trip_collaborators to authenticated;

drop policy if exists "Trip owners can update collaborators" on public.trip_collaborators;
create policy "Trip owners can update collaborators"
  on public.trip_collaborators
  for update
  to authenticated
  using (user_is_trip_owner(trip_id, (select auth.uid())))
  with check (
    user_is_trip_owner(trip_id, (select auth.uid()))
    and (
      role in ('editor', 'voter', 'viewer')
      or (role = 'owner' and user_id = (select auth.uid()))
    )
  );

revoke update on public.trip_invites from public, anon, authenticated;
grant update (is_active) on public.trip_invites to authenticated;

drop policy if exists "Owners and editors can create invites" on public.trip_invites;
create policy "Owners and editors can create invites"
  on public.trip_invites
  for insert
  with check (
    created_by = (select auth.uid())
    and coalesce(use_count, 0) = 0
    and max_uses between 1 and 100
    and (
      exists (
        select 1 from public.trips
         where trips.id = trip_invites.trip_id
           and trips.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.trip_collaborators
         where trip_collaborators.trip_id = trip_invites.trip_id
           and trip_collaborators.user_id = (select auth.uid())
           and trip_collaborators.role = any (array['owner', 'editor'])
      )
    )
  );
