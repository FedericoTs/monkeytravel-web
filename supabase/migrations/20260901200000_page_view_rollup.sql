-- Pre-aggregate page_views so the admin dashboard stops racing an 8s wall.
--
-- WHY A ROLLUP AND NOT MORE TUNING
-- --------------------------------
-- 20260901180000 removed a redundant bot regex and cut the worst RPC from
-- 25.5s to 3.0s. That was necessary and NOT sufficient: on 2026-09-01 all
-- SEVEN geo metrics timed out together in production (Sentry
-- JAVASCRIPT-NEXTJS-2C..2J, every one pg_code 57014).
--
-- The reason is concurrency, which measuring each query alone could never
-- show. app/api/admin/stats/route.ts fires all seven in one Promise.all, and
-- this cluster has:
--
--     max_parallel_workers            2      (for the WHOLE cluster)
--     max_parallel_workers_per_gather 1
--     work_mem                        2184kB
--
-- Each plans a parallel worker, only two can have one, so the rest run
-- single-threaded and every COUNT(DISTINCT) sort spills to disk. Individually
-- 3.5-7.8s; together, all past 8s. That is why metrics which were never slow
-- -- top_pages, unique_visitors, conversion_funnel -- began failing too: they
-- were starved, not slow.
--
-- Growth removes any hope of tuning out of it: 672,830 rows / 334 MB, and
-- 18,101 rows arrived in the last 24 hours alone.
--
-- WHAT THIS DOES
-- --------------
-- Aggregate once per day in a cron (uncontended, no 8s limit), then let the
-- dashboard read a table of a few thousand small rows. Every RPC below becomes
-- an index scan over the rollup instead of a full pass over 334 MB.
--
-- THE ONE THING THAT CANNOT BE SUMMED
-- -----------------------------------
-- Unique visitors. Summing per-day uniques counts a returning visitor once per
-- day, which is "visitor-days", a different number. So:
--   * per-day uniques live in the daily rows and are correct for the trend;
--   * the ALL-TIME distinct count is computed globally and stored in
--     page_view_rollup_meta.
-- Do not be tempted to SUM(unique_visitors) for a total.
--
-- Each metric keeps the fingerprint it already used, so no displayed number
-- changes meaning: the daily trend counts distinct session_id, while the
-- all-time figure keeps the concat(user_agent, country_code, city) fingerprint
-- that count_unique_visitors and the funnel have always used.

CREATE TABLE IF NOT EXISTS public.page_view_rollup (
  day             date   NOT NULL,
  -- 'total' | 'country' | 'city' | 'path' | 'section'
  dimension       text   NOT NULL,
  -- country_code | city | normalised path | section. '' for 'total'.
  key_1           text   NOT NULL DEFAULT '',
  -- country_code for the 'city' dimension, '' otherwise. Empty string rather
  -- than NULL so the primary key actually constrains duplicates.
  key_2           text   NOT NULL DEFAULT '',
  views           bigint NOT NULL DEFAULT 0,
  -- Only meaningful on dimension='total'. NOT summable across days.
  unique_visitors bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dimension, key_1, key_2)
);

CREATE INDEX IF NOT EXISTS idx_page_view_rollup_dim_day
  ON public.page_view_rollup (dimension, day DESC);

-- Singleton. Holds the figures that are only correct when computed globally.
CREATE TABLE IF NOT EXISTS public.page_view_rollup_meta (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  total_views     bigint      NOT NULL DEFAULT 0,
  unique_visitors bigint      NOT NULL DEFAULT 0,
  refreshed_at    timestamptz NOT NULL DEFAULT now()
);

-- Read-only to the app; only the cron (service role) writes. RLS on with no
-- policy = deny-all for anon/authenticated, which is what we want: the RPCs
-- below are SECURITY DEFINER and read it on the caller's behalf.
ALTER TABLE public.page_view_rollup      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_view_rollup_meta ENABLE ROW LEVEL SECURITY;

/**
 * Rebuild the rollup for the most recent p_days days, and recompute the
 * global meta figures.
 *
 * Delete-then-insert per day rather than incremental accumulation: page_views
 * rows can arrive late, and a rebuild is idempotent. p_days defaults to 3 so a
 * daily cron re-does yesterday and the day before, absorbing stragglers.
 *
 * Pass a large p_days (e.g. 4000) to backfill all history.
 */
CREATE OR REPLACE FUNCTION public.refresh_page_view_rollup(p_days integer DEFAULT 3)
 RETURNS TABLE(days_rebuilt integer, rows_written bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from date := (now() - make_interval(days => GREATEST(p_days, 1)))::date;
  v_rows bigint := 0;
  v_n    bigint;
BEGIN
  DELETE FROM public.page_view_rollup WHERE day >= v_from;

  -- 'total': views + per-day unique sessions (what the daily trend renders).
  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views, unique_visitors)
  SELECT created_at::date, 'total', '', '',
         COUNT(*), COUNT(DISTINCT session_id)
  FROM public.page_views_human
  WHERE created_at >= v_from
  GROUP BY 1;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'country', country_code, '', COUNT(*)
  FROM public.page_views_human
  WHERE created_at >= v_from AND country_code IS NOT NULL
  GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'city', city, COALESCE(country_code, ''), COUNT(*)
  FROM public.page_views_human
  WHERE created_at >= v_from AND city IS NOT NULL
  GROUP BY 1, 3, 4;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Path normalisation happens HERE, once, instead of on every dashboard load.
  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'path',
         regexp_replace(
           regexp_replace(path, '^/(es|it)/', '/'),
           '/trips/[0-9a-f-]{36}', '/trips/:id'
         ),
         '', COUNT(*)
  FROM public.page_views_human
  WHERE created_at >= v_from
  GROUP BY 1, 3;
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
  FROM public.page_views_human
  WHERE created_at >= v_from
  GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Global figures. Correct only when computed over everything, which is
  -- affordable here because the cron is uncontended and has no 8s ceiling.
  INSERT INTO public.page_view_rollup_meta (id, total_views, unique_visitors, refreshed_at)
  VALUES (
    true,
    (SELECT COUNT(*) FROM public.page_views),
    (SELECT COUNT(*) FROM (
       SELECT DISTINCT concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,''))
       FROM public.page_views_human
     ) t),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET total_views     = EXCLUDED.total_views,
        unique_visitors = EXCLUDED.unique_visitors,
        refreshed_at    = EXCLUDED.refreshed_at;

  days_rebuilt := GREATEST(p_days, 1);
  rows_written := v_rows;
  RETURN NEXT;
END;
$function$;
