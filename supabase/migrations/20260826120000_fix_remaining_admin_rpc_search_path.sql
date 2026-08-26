-- Follow-up to 20260531_fix_admin_analytics_rpcs_search_path.sql, which
-- repaired 5 of the 8 admin analytics RPCs broken by the day-9 hardening pass
-- (20260531_day9_function_search_path_hardening.sql) and missed 3.
--
-- Same defect, same cause: these functions carry `SET search_path TO ''`
-- while their bodies reference unqualified tables (page_views, trips, users).
-- With an empty search_path the planner cannot resolve those names, so every
-- call throws 42P01. Reproduced on prod (sevfbahwmlbdlnbhqwyi):
--
--   SELECT count(*) FROM count_unique_visitors();
--   ERROR: 42P01: relation "page_views" does not exist
--   CONTEXT: SQL function "count_unique_visitors" during startup
--
-- Why nobody noticed: app/api/admin/stats/route.ts wraps these in
-- Promise.allSettled + a safe() fallback, and a PostgREST rpc() error
-- RESOLVES with {data: null, error} rather than rejecting. So the route
-- returns 200 and the Geo panel renders zeros — unique visitors, top pages
-- and the conversion funnel have been silently empty, not visibly failing.
-- That is also why Sentry has nothing.
--
-- Fix: `search_path TO 'public'`, matching the 7 working siblings and the
-- precedent set by the earlier migration. Bodies are NOT touched.
--
-- On the security trade-off: an empty search_path matters most for
-- SECURITY DEFINER functions, where a caller could otherwise shadow an
-- unqualified name and have it resolve with the definer's privileges. All
-- three functions below are SECURITY INVOKER (prosecdef = false) and run
-- with the caller's own privileges, so pinning to 'public' does not widen
-- any privilege boundary. The definer siblings
-- (get_page_views_by_city / _by_country) already sit on 'public' and are
-- untouched here.
--
-- ALTER rather than CREATE OR REPLACE: this changes only the config, so
-- there is no chance of a reconstructed body drifting from what is live.

ALTER FUNCTION public.count_unique_visitors()  SET search_path TO 'public';
ALTER FUNCTION public.get_conversion_funnel()  SET search_path TO 'public';
ALTER FUNCTION public.get_top_pages()          SET search_path TO 'public';
