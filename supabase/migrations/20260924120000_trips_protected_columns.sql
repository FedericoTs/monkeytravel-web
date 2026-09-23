-- Guard the columns on trips that a trip's owner or editor must not set.
-- Safe to apply at merge time, before the new code is live: with the old
-- code, submit-trending's user-client writes of trending_approved and
-- trending_score are quietly kept at their stored values instead of failing
-- (nothing reads trending_approved; a trip taken off trending keeps its old
-- score but is no longer public). The new code writes them through the
-- service role. Apply 20260924113000 (the view-count trigger) first.
--
-- WHY
-- authenticated holds table-wide INSERT and UPDATE on trips, and the
-- policies only decide WHICH rows: trips_insert_own (user_id = auth.uid())
-- and trips_update (owner, or a collaborator with role 'editor', with the
-- same test in WITH CHECK). Nothing decided which COLUMNS. Found on
-- 2026-09-23 after #175, with the public anon key plus a user's own token:
--   - an editor could set user_id to themselves and take the trip; the owner
--     then fails every policy and loses it. The editor branch of WITH CHECK
--     accepts any new user_id, so a trip could also be pushed into any
--     other account (user ids are listable from public_profiles);
--   - an owner could write their own trip's like_count, fork_count,
--     trending_score, is_editors_pick, is_hidden, reported_count or
--     is_template and put it anywhere on /explore, including un-hiding a
--     trip that reports had hidden;
--   - an insert could arrive with those columns preset, or with
--     parent_trip_id pointing at any trip; handed to other accounts, such
--     children inflate a trip's distinct-forker count.
-- Nobody had used any of it: 0 editors' picks, 0 hidden, no score above its
-- formula, every fork parent public.
--
-- WHAT
-- A BEFORE INSERT OR UPDATE trigger. Callers that are not trusted
-- (current_user other than postgres / service_role / supabase_admin):
--   - UPDATE: changing user_id or parent_trip_id raises 42501. The counters
--     and moderation flags are put back to their stored values without an
--     error, so a stale full-row save from the editor can never fail and a
--     forged value never lands.
--   - INSERT: the counters and flags start at their defaults, and
--     parent_trip_id must name a trip anyone may fork (public, not hidden,
--     not deleted).
-- The guard is SECURITY INVOKER on purpose: inside a SECURITY DEFINER
-- function current_user is always postgres and the guard would do nothing.
-- Every legitimate writer of these columns is trusted: the counter,
-- report, claim, soft-delete and account-deletion functions are definer
-- functions owned by postgres; the editors-pick cron, the report route and
-- submit-trending use the service role; foreign-key cascades run as the
-- table owner.
--
-- Also in here, because the guard needs it and view_count is protected:
-- update_trip_trending_score() now recounts view_count from trip_views
-- (bots excluded) before scoring. The trigger that used to maintain it is
-- gone (20260924113000).
--
-- Not covered, and noted for later: an owner can still set visibility,
-- share_token, author_* through the API directly, which skips the publish
-- route's anti-spam checks. Their score stays 0 until something counts.
--
-- Rollback: drop trigger trips_guard_protected_columns on public.trips.

create or replace function public.trip_is_forkable(p_trip_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.trips
     where id = p_trip_id
       and visibility = 'public'
       and not coalesce(is_hidden, false)
       and deleted_at is null
  );
$function$;

-- The guard runs as the inserting user, so authenticated must be able to
-- call the helper. It answers only "is this trip public", which anyone can
-- already read.
revoke execute on function public.trip_is_forkable(uuid) from public, anon;
grant execute on function public.trip_is_forkable(uuid) to authenticated, service_role;

create or replace function public.trips_guard_protected_columns()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.like_count := 0;
    new.save_count := 0;
    new.fork_count := 0;
    new.template_copy_count := 0;
    new.view_count := 0;
    new.trending_score := 0;
    new.trending_approved := false;
    new.is_editors_pick := false;
    new.is_hidden := false;
    new.reported_count := 0;
    new.is_template := false;
    if new.parent_trip_id is not null and not public.trip_is_forkable(new.parent_trip_id) then
      raise exception 'trips.parent_trip_id must name a public trip'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'trips.user_id cannot be changed here'
      using errcode = '42501';
  end if;
  if new.parent_trip_id is distinct from old.parent_trip_id then
    raise exception 'trips.parent_trip_id cannot be changed here'
      using errcode = '42501';
  end if;

  new.like_count := old.like_count;
  new.save_count := old.save_count;
  new.fork_count := old.fork_count;
  new.template_copy_count := old.template_copy_count;
  new.view_count := old.view_count;
  new.trending_score := old.trending_score;
  new.trending_approved := old.trending_approved;
  new.is_editors_pick := old.is_editors_pick;
  new.is_hidden := old.is_hidden;
  new.reported_count := old.reported_count;
  new.is_template := old.is_template;
  return new;
end;
$function$;

drop trigger if exists trips_guard_protected_columns on public.trips;
create trigger trips_guard_protected_columns
  before insert or update on public.trips
  for each row execute function public.trips_guard_protected_columns();

create or replace function public.update_trip_trending_score(p_trip_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_views integer;
  v_score integer;
begin
  select count(*) into v_views
    from public.trip_views
   where trip_id = p_trip_id and not is_bot;

  update public.trips
     set view_count = v_views,
         trending_score =
             (coalesce(template_copy_count, 0) * 10)
           + (coalesce(fork_count, 0)          * 10)
           + (coalesce(like_count, 0)          *  3)
           + (coalesce(save_count, 0)          *  1)
           +  v_views
           +  greatest(0, 100 - greatest(0,
                extract(epoch from (now() - coalesce(shared_at, created_at))) / 86400
              )::integer)
   where id = p_trip_id
  returning trending_score into v_score;
  return coalesce(v_score, 0);
end;
$function$;

revoke execute on function public.update_trip_trending_score(uuid) from public, anon, authenticated;
grant execute on function public.update_trip_trending_score(uuid) to service_role;
