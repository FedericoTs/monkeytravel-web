-- Point every geo RPC at page_view_rollup, and close an anon read hole.
--
-- Companion to 20260901200000_page_view_rollup.sql. Every function keeps its
-- exact signature, ordering and LIMIT. The rollup itself is exact: verified
-- day-by-day against the source, 272 of 272 closed days matched on both views
-- and unique sessions.
--
-- THREE NUMBERS DO SHIFT, all for the same reason -- a daily rollup has no
-- sub-day resolution, so a window that used to cut at the current clock time
-- now cuts at midnight. Called out individually at each function below:
--   * get_page_views_daily_trend -- oldest bar is now a full day, not partial
--   * get_page_views_by_section  -- same, so its total reads slightly higher
--   * get_page_view_totals       -- 7d/30d become calendar days
-- Everything all-time (country, city, top pages, unique visitors, the funnel,
-- the headline total) is byte-identical.
--
-- TWO THINGS THAT ARE NOT JUST "SELECT FROM THE ROLLUP"
--
-- 1. SECURITY DEFINER is now mandatory, not stylistic. page_view_rollup has RLS
--    enabled with no policy, so an INVOKER function reading it returns zero
--    rows -- silently, which is the exact failure mode round 6 existed to
--    eliminate. Five of these seven were invoker. All seven are definer now.
--
-- 2. anon could execute five of them. Measured before this migration:
--       anon EXECUTE: count_unique_visitors, get_conversion_funnel,
--                     get_page_views_by_section, get_page_views_daily_trend,
--                     get_top_pages
--    and anon holds SELECT on page_views_human, so a signed-out visitor could
--    pull the site's traffic, funnel and top pages. Pre-existing, not
--    introduced here -- but get_page_views_by_country/by_city were already
--    definer AND not anon-executable, so closing the other five matches intent
--    that was already half-applied. app/api/admin/stats/route.ts calls these
--    through createAdminClient() (service_role), so revoking anon/authenticated
--    cannot affect the dashboard.

-- Bot-inclusive daily totals, so the three count(*) scans in route.ts can be
-- served from here too. Measured uncontended against the live table:
--   count(*) page_views              7,047 ms   <- at the 8s wall on its own
--   count(*) last 7 days             2,668 ms
-- and both ran inside the same Promise.all as the seven RPCs.
CREATE OR REPLACE FUNCTION public.refresh_page_view_rollup(p_days integer DEFAULT 3)
 RETURNS TABLE(days_rebuilt integer, rows_written bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_from date := (now() - make_interval(days => GREATEST(p_days, 1)))::date;
  v_rows bigint := 0;
  v_n    bigint;
BEGIN
  DELETE FROM public.page_view_rollup WHERE day >= v_from;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views, unique_visitors)
  SELECT created_at::date, 'total', '', '', COUNT(*), COUNT(DISTINCT session_id)
  FROM public.page_views_human WHERE created_at >= v_from GROUP BY 1;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- 'all' includes bots. page_views (not _human) on purpose: the dashboard's
  -- headline total has always counted every row, and this migration is not the
  -- place to silently restate it.
  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'all', '', '', COUNT(*)
  FROM public.page_views WHERE created_at >= v_from GROUP BY 1;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'country', country_code, '', COUNT(*)
  FROM public.page_views_human
  WHERE created_at >= v_from AND country_code IS NOT NULL GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'city', city, COALESCE(country_code, ''), COUNT(*)
  FROM public.page_views_human
  WHERE created_at >= v_from AND city IS NOT NULL GROUP BY 1, 3, 4;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'path',
         regexp_replace(regexp_replace(path, '^/(es|it)/', '/'), '/trips/[0-9a-f-]{36}', '/trips/:id'),
         '', COUNT(*)
  FROM public.page_views_human WHERE created_at >= v_from GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'section',
         CASE
           WHEN path ~ '^/(es|it|pt)?/?$' THEN 'landing'
           WHEN path LIKE '%/trips%' THEN 'trips'
           WHEN path LIKE '%/auth%' OR path LIKE '%/login%' OR path LIKE '%/signup%' THEN 'auth'
           WHEN path LIKE '%/blog%' THEN 'blog'
           WHEN path LIKE '%/destinations%' THEN 'destinations'
           WHEN path LIKE '%/profile%' THEN 'profile'
           WHEN path LIKE '%/admin%' THEN 'admin'
           ELSE 'other'
         END,
         '', COUNT(*)
  FROM public.page_views_human WHERE created_at >= v_from GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup_meta (id, total_views, unique_visitors, refreshed_at)
  VALUES (
    true,
    (SELECT COUNT(*) FROM public.page_views),
    (SELECT COUNT(*) FROM (
       SELECT DISTINCT concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,''))
       FROM public.page_views_human) t),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET total_views = EXCLUDED.total_views,
        unique_visitors = EXCLUDED.unique_visitors,
        refreshed_at = EXCLUDED.refreshed_at;

  days_rebuilt := GREATEST(p_days, 1);
  rows_written := v_rows;
  RETURN NEXT;
END;
$function$;

-- All-time distinct fingerprint. Cannot be summed from daily rows -- summing
-- per-day uniques counts a returning visitor once per day. Read from meta,
-- where it is computed globally.
CREATE OR REPLACE FUNCTION public.count_unique_visitors()
 RETURNS TABLE(count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT unique_visitors FROM public.page_view_rollup_meta), 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_country()
 RETURNS TABLE(country_code text, count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT key_1, SUM(views)::bigint
  FROM public.page_view_rollup
  WHERE dimension = 'country'
  GROUP BY key_1
  ORDER BY 2 DESC
  LIMIT 20;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_city()
 RETURNS TABLE(city text, country_code text, count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT key_1, NULLIF(key_2, ''), SUM(views)::bigint
  FROM public.page_view_rollup
  WHERE dimension = 'city'
  GROUP BY key_1, key_2
  ORDER BY 3 DESC
  LIMIT 20;
$function$;

-- Paths were normalised once at rollup time, so this no longer runs two
-- regexp_replace calls per row across 550k rows on every dashboard load.
CREATE OR REPLACE FUNCTION public.get_top_pages()
 RETURNS TABLE(path text, count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT key_1, SUM(views)::bigint
  FROM public.page_view_rollup
  WHERE dimension = 'path'
  GROUP BY key_1
  ORDER BY 2 DESC
  LIMIT 20;
$function$;

-- 30 days, matching the UI selector (capped to 7d/30d in round 6). Per-day
-- uniques come straight from the stored column -- correct, because each day's
-- distinct count was computed over that day's rows, never summed across them.
--
-- `>= CURRENT_DATE - 30` spans 31 dates, matching what the old rolling
-- `NOW() - INTERVAL '30 days'` returned. One real difference remains and
-- cannot be engineered away: the old window cut the OLDEST day at the current
-- clock time, so the chart's first bar was a partial day. A daily rollup has
-- no sub-day resolution, so that bar is now a full day and reads higher. For a
-- trend chart that is an improvement -- the old first bar sloped down for no
-- reason other than when you loaded the page -- but it IS a changed number.
-- Same applies to get_page_views_by_section below.
CREATE OR REPLACE FUNCTION public.get_page_views_daily_trend()
 RETURNS TABLE(date text, views bigint, unique_visitors bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT day::text, views, unique_visitors
  FROM public.page_view_rollup
  WHERE dimension = 'total' AND day >= CURRENT_DATE - 30
  ORDER BY day;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_section()
 RETURNS TABLE(section text, count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT key_1, SUM(views)::bigint
  FROM public.page_view_rollup
  WHERE dimension = 'section' AND day >= CURRENT_DATE - 30
  GROUP BY key_1
  ORDER BY 2 DESC;
$function$;

-- Only the 'visitors' step touched page_views; the other three count small
-- tables and are unchanged.
CREATE OR REPLACE FUNCTION public.get_conversion_funnel()
 RETURNS TABLE(step text, count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT 'visitors', COALESCE((SELECT unique_visitors FROM public.page_view_rollup_meta), 0)
  UNION ALL
  SELECT 'signups', (SELECT COUNT(*) FROM public.users)
  UNION ALL
  SELECT 'trip_creators', (SELECT COUNT(DISTINCT user_id) FROM public.trips)
  UNION ALL
  SELECT 'shared_trips', (SELECT COUNT(*) FROM public.trips WHERE share_token IS NOT NULL);
$function$;

-- Replaces three count(*) scans in route.ts (7,047ms / 2,668ms / ~4s).
--
-- WINDOW SEMANTICS CHANGE, stated plainly: last_7_days/last_30_days were
-- rolling timestamp windows (now() - 7 days). A daily rollup can only answer
-- in calendar days, so these are now the last 7 and 30 CALENDAR days including
-- today. Expect roughly half a day's difference against the old figure. The
-- all-time total is unchanged and exact.
CREATE OR REPLACE FUNCTION public.get_page_view_totals()
 RETURNS TABLE(total_views bigint, last_7_days bigint, last_30_days bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE((SELECT m.total_views FROM public.page_view_rollup_meta m), 0),
    COALESCE((SELECT SUM(views) FROM public.page_view_rollup
              WHERE dimension = 'all' AND day > CURRENT_DATE - 7), 0)::bigint,
    COALESCE((SELECT SUM(views) FROM public.page_view_rollup
              WHERE dimension = 'all' AND day > CURRENT_DATE - 30), 0)::bigint;
$function$;

-- Admin-only metrics reached exclusively via service_role. Nothing else should
-- be able to call them.
--
-- FROM PUBLIC is load-bearing, not belt-and-braces. Postgres grants EXECUTE to
-- PUBLIC by default on every new function, and anon/authenticated inherit
-- through it -- they are never granted explicitly. So "REVOKE ... FROM anon,
-- authenticated" revokes a grant that does not exist: it succeeds, prints no
-- warning, and leaves the function callable by anon. Measured on production
-- after the function bodies above had been applied: signed-out anon could still
-- read get_top_pages (20 rows), get_page_views_by_section (7) and
-- get_page_view_totals (674,610 views), and could call refresh_page_view_rollup
-- (a SECURITY DEFINER function that DELETEs and re-INSERTs rollup rows).
-- by_country/by_city were the only two already closed -- their ACL had no "=X"
-- PUBLIC entry, which is what a real revoke looks like.
REVOKE EXECUTE ON FUNCTION public.count_unique_visitors()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_conversion_funnel()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_by_section()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_daily_trend()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_top_pages()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_by_country()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_views_by_city()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_page_view_totals()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_page_view_rollup(integer) FROM PUBLIC, anon, authenticated;
