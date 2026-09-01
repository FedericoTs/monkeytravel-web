-- The traffic dashboard was showing blanks, and could not say so.
--
-- WHAT WAS WRONG
-- --------------
-- `authenticated` and `authenticator` both carry statement_timeout = 8s
-- (pg_db_role_setting), and PostgREST connects as authenticator -- so 8s is a
-- hard wall no matter what the global timeout says. Measured today:
--
--     get_page_views_by_section     25,499 ms
--     get_page_views_daily_trend    23,523 ms
--     get_page_views_by_country     15,035 ms
--     get_page_views_by_city        14,337 ms
--     get_top_pages                 passes
--
-- app/api/admin/stats/route.ts read every result as `(x.data || [])`, so a
-- timeout became an empty array. Geo, daily trend and section breakdown
-- rendered as zero -- indistinguishable from "we have no traffic" -- while
-- activation decisions were being made from that screen.
--
-- CAUSE 1: A REDUNDANT REGEX (all four)
-- Each RPC re-filtered bots with a 40-alternative case-insensitive regex over
-- user_agent, row by row across 671,433 rows / 333 MB:
--
--     AND (user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|...)')
--
-- Entirely redundant: they all read public.page_views_human, defined as
-- `SELECT ... FROM page_views WHERE is_bot = false`. is_bot is fully populated
-- (122,068 true / 549,365 false / ZERO null) and there is already a partial
-- index `idx_page_views_human_created_at ... WHERE (is_bot = false)`. The
-- regex re-derived, one row at a time, a boolean already computed and stored.
--
-- The correlation is the proof: the four RPCs carrying the regex are exactly
-- the four that timed out; every RPC without it (get_top_pages,
-- count_unique_visitors, get_conversion_funnel, get_referrer_breakdown)
-- passed.
--
-- CAUSE 2: COUNT(DISTINCT) OVER A DERIVED STRING (section + daily trend)
-- Both counted unique visitors as
-- COUNT(DISTINCT concat(user_agent, country_code, city)). EXPLAIN ANALYZE
-- showed the sort spilling to disk -- "external merge Disk: 23480kB" -- which
-- dominated the runtime. It was also a poor fingerprint: it yields 27,087
-- "visitors" against 129,730 distinct session_ids, because everyone sharing a
-- browser, country and city collapses into one.
--
-- WHAT CHANGED, MEASURED
--     get_page_views_by_country   regex dropped                    -> passes
--     get_page_views_by_city      regex dropped                    -> passes
--     get_page_views_daily_trend  regex dropped, DISTINCT session_id,
--                                 window 90d -> 30d   23,523 -> 5,990 ms
--     get_page_views_by_section   see below      25,499 -> 2,998 ms
--
-- get_page_views_by_section needed more than the regex fix. EXPLAIN ANALYZE
-- proved the remaining cost was simply READING the table: even a bare
-- COUNT(*) GROUP BY over all-time was 11,200 ms on a Parallel Seq Scan, and
-- the partial index is only usable with a created_at predicate. So it is now
-- bounded to 30 days (145,147 rows, Index Scan) -- 90 days does not help,
-- because 83% of rows fall inside it.
--
-- It also no longer computes unique_visitors at all: NOTHING rendered that
-- number. components/admin/TrafficOverview.tsx uses only `count` and derives
-- its own total from the returned rows, so the window cannot skew its
-- percentages. The field is removed end-to-end (RPC, route mapping, TS type,
-- component prop) rather than stubbed to 0, so no phantom value can appear.
-- The panel is labelled "(30 days)" so the window is visible to the reader.
--
-- by_country and by_city stay ALL-TIME deliberately: route.ts computes their
-- `percentage` against an all-time totalPageViews, so windowing the numerator
-- alone would silently produce wrong percentages.
--
-- WHY daily_trend ALSO LOST 60 DAYS
-- It must keep a usable window because TrafficOverview slices client-side from
-- what it returns. At 90 days it measured 7.2s on one run and 11.1s on the
-- next -- it BLANKED INTERMITTENTLY, the same failure, just harder to
-- reproduce. work_mem = 64MB was tried and did not help. 83% of rows fall
-- inside 90 days, so that window barely restricts anything and the planner
-- reverts to a Parallel Seq Scan; only 30 days is selective enough to use
-- idx_page_views_human_created_at. The UI selector is capped to 7d/30d to
-- match, because a 90d option that renders nothing is worse than an honest
-- 30d chart.
--
-- HEADROOM, STATED HONESTLY
-- page_views grows ~10,855 rows/day with NO retention, and daily_trend is
-- still ~6s against an 8s wall. This buys time, not permanence. Every 90-day
-- aggregate measured here landed at 7s+, so the durable answer is a daily
-- rollup table (or a retention policy), not a bigger timeout. Until then the
-- protection is that failures are now LOUD: app/api/admin/stats/route.ts
-- reports each failed metric to Sentry and returns a `degraded` list, so a
-- zero can no longer masquerade as "no traffic".

CREATE OR REPLACE FUNCTION public.get_page_views_by_country()
 RETURNS TABLE(country_code text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pv.country_code, COUNT(*)::bigint as count
  FROM public.page_views_human pv
  WHERE pv.country_code IS NOT NULL
  GROUP BY pv.country_code
  ORDER BY count DESC
  LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_city()
 RETURNS TABLE(city text, country_code text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pv.city, pv.country_code, COUNT(*)::bigint as count
  FROM public.page_views_human pv
  WHERE pv.city IS NOT NULL
  GROUP BY pv.city, pv.country_code
  ORDER BY count DESC
  LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_daily_trend()
 RETURNS TABLE(date text, views bigint, unique_visitors bigint)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT
    to_char(created_at, 'YYYY-MM-DD') as date,
    COUNT(*) as views,
    COUNT(DISTINCT session_id) as unique_visitors
  FROM public.page_views_human
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY 1
  ORDER BY 1;
$function$;

-- Signature changes (unique_visitors dropped), so the old one must go first.
DROP FUNCTION IF EXISTS public.get_page_views_by_section();

CREATE FUNCTION public.get_page_views_by_section()
 RETURNS TABLE(section text, count bigint)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN path ~ '^/(es|it|pt)?/?$' THEN 'landing'
      WHEN path LIKE '%/trips%' THEN 'trips'
      WHEN path LIKE '%/auth%' OR path LIKE '%/login%' OR path LIKE '%/signup%' THEN 'auth'
      WHEN path LIKE '%/blog%' THEN 'blog'
      WHEN path LIKE '%/destinations%' THEN 'destinations'
      WHEN path LIKE '%/profile%' THEN 'profile'
      WHEN path LIKE '%/admin%' THEN 'admin'
      ELSE 'other'
    END as section,
    COUNT(*) as count
  FROM public.page_views_human
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY 1
  ORDER BY count DESC;
$function$;
