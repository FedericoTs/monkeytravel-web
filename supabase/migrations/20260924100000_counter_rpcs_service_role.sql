-- Close the engagement counters to direct calls, and make the like, save and
-- fork counters count rows instead of stepping by one. The follow-up that
-- 20260924092000 named and deliberately left open.
--
-- 1. WHO CAN CALL THEM
-- increment/decrement_trip_like_count, increment/decrement_trip_save_count,
-- increment_trip_fork_count, increment_template_copy_count and
-- update_trip_trending_score are SECURITY DEFINER and check nothing about the
-- caller. `authenticated` could execute all seven, so any account could call
-- POST /rest/v1/rpc/increment_trip_fork_count in a loop and push any public
-- trip up /explore (a fork is worth 10 points of trending score, a like 3, a
-- template copy 10). 20260601 revoked them from PUBLIC and anon but never
-- from authenticated, the same gap as 20260924090000.
--
-- The like, save, fork, template-copy, publish and submit-trending routes
-- used to call them with the signed-in user's own client. They now go
-- through lib/explore/counters.ts on the service-role client, so the
-- functions are revoked from everyone else below.
--
-- 2. WHAT THEY COUNT
-- Closing the functions was not enough on its own. They stepped the stored
-- number by one, and people can add and remove their OWN trip_likes /
-- trip_saves rows directly (RLS: auth.uid() = user_id). So through the
-- routes, found in the adversarial review of this change:
--   - like through the route (+1), delete the row directly, repeat:
--     unbounded inflation, 2 requests a point;
--   - insert a row directly (not counted), unlike through the route (-1),
--     repeat: any trip's count driven to 0;
--   - an anonymous save is not counted, but sign-in re-keys it to the
--     account, and a later unsave took one off someone else's save;
--   - fork the same trip N times: +N forks, +10N trending.
-- Each function now recounts from the rows, so the stored number is always
-- what the rows say however they got there:
--   like_count = trip_likes rows (one per account per trip, by primary key)
--   save_count = trip_saves rows WITH a user_id. Cookie-keyed anonymous
--                saves are left out: a visitor mints a fresh cookie by
--                dropping the old one. They never counted in production
--                either (anon could not execute the counter). Once sign-in
--                re-keys one to an account it counts.
--   fork_count = distinct accounts, other than the owner, with a trip whose
--                parent_trip_id is this trip. Forking twice is one fork.
-- The increment_* / decrement_* names are kept so callers do not change;
-- both directions now do the same thing. The trip row is locked first so
-- the count runs on a snapshot taken after any concurrent recount committed
-- (READ COMMITTED gives each statement in a volatile function a fresh
-- snapshot); a count read before the lock could write a stale lower value.
--
-- increment_template_copy_count still steps by one: a copied trip records
-- no link to its template, so there is nothing to count. The target set is
-- the 7 system templates (user_id NULL), and the route is the only way in.
--
-- 3. ORDER MATTERS
-- Apply only once the code that routes the calls through the service role
-- is live in production. Applied before, every like, save, fork, copy and
-- publish would still succeed but its counter would silently stop moving.
-- Rolling Vercel back to a deployment from before that code has the same
-- effect. Rollback: re-grant execute to authenticated (the new bodies are
-- safe to keep).
--
-- Checked 2026-09-23 before writing this: none of the seven reads
-- auth.uid(), no trigger or cron job calls them, and the only callers inside
-- the database are the counters calling update_trip_trending_score, which
-- run as the owner and are unaffected. Stored counts against rows: 1 like /
-- like_count 1; 0 saves; one trip with fork_count 2 whose two forks come
-- from one account. The resync at the end moves that one to what the rows
-- say. No sign the holes were used.

create or replace function public.increment_trip_like_count(p_trip_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count integer;
begin
  perform 1 from public.trips where id = p_trip_id for update;
  select count(*) into v_count from public.trip_likes where trip_id = p_trip_id;
  update public.trips set like_count = v_count where id = p_trip_id;
  perform update_trip_trending_score(p_trip_id);
  return coalesce(v_count, 0);
end;
$function$;

create or replace function public.decrement_trip_like_count(p_trip_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Same recount as increment_trip_like_count; the name is kept for callers.
  return public.increment_trip_like_count(p_trip_id);
end;
$function$;

create or replace function public.increment_trip_save_count(p_trip_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count integer;
begin
  perform 1 from public.trips where id = p_trip_id for update;
  select count(*) into v_count from public.trip_saves
   where trip_id = p_trip_id and user_id is not null;
  update public.trips set save_count = v_count where id = p_trip_id;
  perform update_trip_trending_score(p_trip_id);
  return coalesce(v_count, 0);
end;
$function$;

create or replace function public.decrement_trip_save_count(p_trip_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Same recount as increment_trip_save_count; the name is kept for callers.
  return public.increment_trip_save_count(p_trip_id);
end;
$function$;

create or replace function public.increment_trip_fork_count(p_trip_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_count integer;
begin
  select user_id into v_owner from public.trips where id = p_trip_id for update;
  select count(distinct c.user_id) into v_count
    from public.trips c
   where c.parent_trip_id = p_trip_id
     and c.user_id is not null
     and c.user_id is distinct from v_owner;
  update public.trips set fork_count = v_count where id = p_trip_id;
  perform update_trip_trending_score(p_trip_id);
  return coalesce(v_count, 0);
end;
$function$;

-- One-time resync of every trip whose stored counts disagree with its rows.
do $$
declare r record;
begin
  for r in
    select t.id
      from public.trips t
     where t.like_count is distinct from
             (select count(*) from public.trip_likes l where l.trip_id = t.id)
        or t.save_count is distinct from
             (select count(*) from public.trip_saves s where s.trip_id = t.id and s.user_id is not null)
        or t.fork_count is distinct from
             (select count(distinct c.user_id) from public.trips c
               where c.parent_trip_id = t.id and c.user_id is not null
                 and c.user_id is distinct from t.user_id)
  loop
    perform public.increment_trip_like_count(r.id);
    perform public.increment_trip_save_count(r.id);
    perform public.increment_trip_fork_count(r.id);
  end loop;
end;
$$;

revoke execute on function public.increment_trip_like_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_trip_like_count(uuid) to service_role;

revoke execute on function public.decrement_trip_like_count(uuid) from public, anon, authenticated;
grant execute on function public.decrement_trip_like_count(uuid) to service_role;

revoke execute on function public.increment_trip_save_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_trip_save_count(uuid) to service_role;

revoke execute on function public.decrement_trip_save_count(uuid) from public, anon, authenticated;
grant execute on function public.decrement_trip_save_count(uuid) to service_role;

revoke execute on function public.increment_trip_fork_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_trip_fork_count(uuid) to service_role;

revoke execute on function public.increment_template_copy_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_template_copy_count(uuid) to service_role;

revoke execute on function public.update_trip_trending_score(uuid) from public, anon, authenticated;
grant execute on function public.update_trip_trending_score(uuid) to service_role;
