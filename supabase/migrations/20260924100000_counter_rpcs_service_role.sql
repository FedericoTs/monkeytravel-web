-- Close the engagement counters to direct calls. The follow-up that
-- 20260924092000 named and deliberately left open.
--
-- increment/decrement_trip_like_count, increment/decrement_trip_save_count,
-- increment_trip_fork_count, increment_template_copy_count and
-- update_trip_trending_score are SECURITY DEFINER and check nothing about the
-- caller: they take a trip id, add or remove one, and recompute the trip's
-- trending score. `authenticated` could execute all seven, so any account
-- could call POST /rest/v1/rpc/increment_trip_fork_count in a loop and push
-- any public trip up /explore (a fork is worth 10 points of trending score,
-- a like 3, a template copy 10). 20260601 revoked them from PUBLIC and anon
-- but never from authenticated, the same gap as 20260924090000.
--
-- The like, save, fork, template-copy, publish and submit-trending routes
-- used to call them with the signed-in user's own client, so revoking first
-- would have broken those features. They now go through
-- lib/explore/counters.ts, which uses the service-role client, after each
-- route's own check (public and not hidden, ownership, or a deduplicating
-- insert/delete on trip_likes / trip_saves).
--
-- ORDER MATTERS: apply this only once the code that routes the calls through
-- the service role is live in production. Applied before, every like, save,
-- fork, copy and publish would still succeed but its counter would silently
-- stop moving. Rollback: re-grant execute to authenticated.
--
-- Checked 2026-09-23 before writing this: none of the seven reads auth.uid(),
-- no trigger or cron job calls them, and the only callers inside the
-- database are the counters calling update_trip_trending_score, which run as
-- the owner and are unaffected. Stored counters match their rows (1 like,
-- 1 like_count; 2 forks, fork_count 2; 0 saves), so there is no sign that
-- the hole was used.

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
