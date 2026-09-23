-- Close page_views_human to the public API. Applied to production on
-- 2026-09-23, before merge, because it was an active exposure.
--
-- page_views_human (20260905090000, rebuilt in 20260917210000) is an
-- ordinary view owned by postgres, so it ran with the owner's rights and
-- page_views' row-level security never applied to it. It kept the default
-- grants, anon=arwdDxtm and authenticated=arwdDxtm, and as a simple
-- one-table view it is auto-updatable. With the public anon key, which ships
-- in the browser bundle, anyone could:
--   - read every visitor row, with user_id, city, latitude, longitude,
--     country and user agent. Verified from outside: GET
--     /rest/v1/page_views_human returned rows while the base table
--     page_views returned none;
--   - DELETE or PATCH those rows, wiping or rewriting the analytics that
--     every volume figure is built on.
-- Edge logs for 16-23 Sep (their whole retention) show no request to it
-- other than our own probe on 23 Sep. What happened before 16 Sep cannot be
-- seen.
--
-- Nothing in the app reads it with a user or anon key. The readers are
-- postgres-owned SECURITY DEFINER functions (refresh_page_view_rollup,
-- get_live_trip_baseline, get_live_trip_participant_metrics,
-- user_inferred_ui_locale), pg_cron jobs running as postgres, and
-- get_engagement_metrics(), which only app/api/admin/stats calls, through
-- the service-role client.
--
-- 1. Revoke everything from anon and authenticated; service_role keeps it.
-- 2. security_invoker, so if a grant ever comes back the caller's own
--    page_views row-level security applies instead of the owner's rights.
--    The definer functions above run as postgres and service_role bypasses
--    RLS, so neither changes.
-- 3. get_engagement_metrics() is SECURITY INVOKER but was executable by anon
--    and authenticated, and read this view. Service role only now, like the
--    admin route that calls it.

revoke all on public.page_views_human from public, anon, authenticated;
grant select on public.page_views_human to service_role;

alter view public.page_views_human set (security_invoker = true);

revoke execute on function public.get_engagement_metrics() from public, anon, authenticated;
grant execute on function public.get_engagement_metrics() to service_role;
