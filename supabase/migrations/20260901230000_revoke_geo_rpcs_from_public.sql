-- The REVOKE in 20260901210000 was a NO-OP. This is the one that works.
--
-- WHAT WENT WRONG
-- ---------------
-- `REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated` removed grants
-- those roles never separately held. Postgres grants EXECUTE on every new
-- function to PUBLIC by default, and anon/authenticated reach it that way.
-- Verified after applying: has_function_privilege('anon', ...) still returned
-- TRUE for five of the seven.
--
-- The ACLs show it plainly. get_page_views_by_country, locked down in an
-- earlier change, reads:
--     {postgres=X/postgres,service_role=X/postgres}
-- while the others read:
--     {=X/postgres,postgres=X/postgres,service_role=X/postgres}
-- That leading bare `=` IS PUBLIC. Checking the working example's ACL rather
-- than trusting the REVOKE to have done something is what caught this.
--
-- WHY IT MATTERS
-- --------------
-- anon could call count_unique_visitors, get_conversion_funnel,
-- get_page_views_by_section, get_page_views_daily_trend and get_top_pages, and
-- anon holds SELECT on page_views_human -- so a signed-out visitor could pull
-- the site's traffic totals, conversion funnel and top pages.
--
-- service_role holds an explicit grant on all of these, so dropping PUBLIC
-- does not affect the admin dashboard, which reaches them via
-- createAdminClient(). Confirmed after applying: anon=false, authenticated=
-- false, service_role=true on all nine.
REVOKE EXECUTE ON FUNCTION public.count_unique_visitors()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_conversion_funnel()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_by_section()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_daily_trend()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_top_pages()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_by_country()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_by_city()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_view_totals()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_page_view_rollup(integer) FROM PUBLIC, anon, authenticated;

-- Explicit, so access never depends on an inherited default.
GRANT EXECUTE ON FUNCTION public.count_unique_visitors()           TO service_role;
GRANT EXECUTE ON FUNCTION public.get_conversion_funnel()           TO service_role;
GRANT EXECUTE ON FUNCTION public.get_page_views_by_section()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_page_views_daily_trend()      TO service_role;
GRANT EXECUTE ON FUNCTION public.get_top_pages()                   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_page_views_by_country()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_page_views_by_city()          TO service_role;
GRANT EXECUTE ON FUNCTION public.get_page_view_totals()            TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_page_view_rollup(integer) TO service_role;
