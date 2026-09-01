-- Make the refresh cheap enough to be safe, and schedule it where it can run.
--
-- WHY THIS EXISTS SEPARATELY FROM 20260901210000
-- ----------------------------------------------
-- The refresh function as first written took 15,166 ms. That is fine when a
-- migration runs it, and fatal for a scheduled job triggered over PostgREST,
-- which connects as `authenticator` with statement_timeout = 8s -- the same
-- wall this entire change exists to escape. A job that dies mid-run leaves the
-- rollup partially DELETEd, so "it usually finishes in time" is not a design.
--
-- Two things were measured, not assumed:
--
-- 1. A function-scoped `SET statement_timeout TO '55s'` DOES NOT WORK. Tested
--    directly: with the caller at `SET LOCAL statement_timeout = '1s'`, the
--    function still died with 57014 despite declaring 55s. statement_timeout
--    is armed when the top-level statement begins, and a function-local SET
--    does not re-arm the running timer. Do not try this again.
--
-- 2. The cost was almost entirely one query: the all-time unique-visitor
--    DISTINCT over a derived string, 9,185 ms on its own and growing with the
--    table. It is the one figure that cannot be summed from daily rows, so it
--    was being recomputed globally every single run.
--
-- Fixing (2) and scheduling with pg_cron instead of PostgREST removes both
-- problems: 15,166 ms -> 4,719 ms cold, 2,050 ms warm, with no 8s ceiling.

-- Keep the fingerprint set instead of recomputing it.
--
-- APPEND-ONLY, ON PURPOSE. If page_views ever gets a retention policy, this
-- keeps fingerprints whose rows were deleted, so "unique visitors, all time"
-- stays a true all-time figure instead of silently shrinking. It also means the
-- number can never go down -- correct for an all-time metric, WRONG if this
-- table is ever reused for a windowed one. Do not reuse it that way.
CREATE TABLE IF NOT EXISTS public.page_view_fingerprint (
  fp         text PRIMARY KEY,
  first_seen date NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE public.page_view_fingerprint ENABLE ROW LEVEL SECURITY;

-- One-time seed of all history. Safe here: a migration has no 8s ceiling.
-- Verified to reproduce the query it replaces exactly -- 27,145 kept
-- fingerprints against 27,145 from the live DISTINCT.
INSERT INTO public.page_view_fingerprint (fp, first_seen)
SELECT concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,'')),
       MIN(created_at)::date
FROM public.page_views_human
GROUP BY 1
ON CONFLICT (fp) DO NOTHING;

-- Final form. Note the absence of `SET statement_timeout` -- see (1) above.
CREATE OR REPLACE FUNCTION public.refresh_page_view_rollup(p_days integer DEFAULT 3)
 RETURNS TABLE(days_rebuilt integer, rows_written bigint)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
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

  -- Only fingerprints first seen in this window, instead of a 9.2s global
  -- DISTINCT over every human row.
  INSERT INTO public.page_view_fingerprint (fp, first_seen)
  SELECT concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,'')),
         MIN(created_at)::date
  FROM public.page_views_human
  WHERE created_at >= v_from
  GROUP BY 1
  ON CONFLICT (fp) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- total_views sums the 'all' dimension rather than running COUNT(*) over
  -- page_views (7,047 ms measured). Exact: the rollup covers every day that
  -- exists, and page views are always inserted at the current time.
  INSERT INTO public.page_view_rollup_meta (id, total_views, unique_visitors, refreshed_at)
  VALUES (
    true,
    COALESCE((SELECT SUM(views) FROM public.page_view_rollup WHERE dimension = 'all'), 0),
    (SELECT COUNT(*) FROM public.page_view_fingerprint),
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

-- Expose rollup freshness. Pre-aggregation introduces a failure mode the live
-- queries did not have: if the job stops, every number keeps rendering at full
-- confidence while quietly ageing. The caller marks the metrics degraded past
-- 36h. Return type changes, so this is a DROP rather than a REPLACE.
DROP FUNCTION IF EXISTS public.get_page_view_totals();

CREATE FUNCTION public.get_page_view_totals()
 RETURNS TABLE(total_views bigint, last_7_days bigint, last_30_days bigint, refreshed_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE((SELECT m.total_views FROM public.page_view_rollup_meta m), 0),
    COALESCE((SELECT SUM(views) FROM public.page_view_rollup
              WHERE dimension = 'all' AND day > CURRENT_DATE - 7), 0)::bigint,
    COALESCE((SELECT SUM(views) FROM public.page_view_rollup
              WHERE dimension = 'all' AND day > CURRENT_DATE - 30), 0)::bigint,
    (SELECT m.refreshed_at FROM public.page_view_rollup_meta m);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_page_view_totals() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_page_view_rollup(integer) FROM anon, authenticated;

-- Schedule INSIDE Postgres. A Vercel cron would go through PostgREST and hit
-- the 8s `authenticator` wall; pg_cron has no such ceiling.
--
-- 02:40 UTC is clear of every existing Vercel cron (03:41, 03:53, 04:23,
-- 05:12, 05:17, 06:00, 07:00), so the rebuild never contends with them for the
-- two parallel workers this cluster has.
--
-- p_days => 3 rebuilds today plus the two previous days, so late-arriving rows
-- are absorbed and a single missed night self-heals.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'refresh-page-view-rollup',
  '40 2 * * *',
  $$SELECT public.refresh_page_view_rollup(3)$$
);
