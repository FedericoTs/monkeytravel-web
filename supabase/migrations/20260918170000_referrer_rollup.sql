-- Referrer breakdown from the rollup, not a full scan (2026-09-18).
--
-- WHAT HAPPENED
-- get_referrer_breakdown() grouped EVERY row of page_views_human by referrer
-- source, no window, on every admin dashboard load: 10 seconds against
-- PostgREST's 8-second statement timeout, so the panel failed on every load
-- (44 of the 500s on 2026-09-17 were this). Every other traffic panel reads
-- page_view_rollup and answers in milliseconds.
--
-- WHAT THIS DOES
--   referrer_source(referrer)   the classification, as a function, so the
--                               refresh and anyone else share one definition.
--   refresh_page_view_rollup()  also writes a 'referrer' dimension
--                               (key_1 = source) per day from page_views_human.
--   get_referrer_breakdown()    sums that dimension. Same shape, same all-time
--                               semantics, milliseconds.
--
-- One-off backfill after applying (the nightly job only rebuilds 3 days):
--   delete from public.page_view_rollup where dimension = 'referrer';
--   insert into public.page_view_rollup (day, dimension, key_1, key_2, views)
--   select created_at::date, 'referrer', public.referrer_source(referrer), '', count(*)
--   from public.page_views_human group by 1, 3;

create or replace function public.referrer_source(p_referrer text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_referrer is null or p_referrer = '' then 'direct'
    when p_referrer like '%monkeytravel.app%' then 'internal'
    when p_referrer like '%vercel.app%' or p_referrer like '%localhost%' then 'dev'
    when p_referrer like '%google%' then 'google'
    when p_referrer like '%bing%' then 'bing'
    when p_referrer like '%facebook%' or p_referrer like '%fb.com%' or p_referrer like '%fbclid%' then 'facebook'
    when p_referrer like '%instagram%' then 'instagram'
    when p_referrer like '%twitter%' or p_referrer like '%t.co%' or p_referrer like '%x.com%' then 'twitter'
    when p_referrer like '%linkedin%' then 'linkedin'
    when p_referrer like '%reddit%' then 'reddit'
    when p_referrer like '%youtube%' then 'youtube'
    when p_referrer like '%tiktok%' then 'tiktok'
    else 'other'
  end;
$$;

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

  -- Referrer source per day (2026-09-18): the admin panel used to compute this
  -- over the whole table on every load.
  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'referrer', public.referrer_source(referrer), '', COUNT(*)
  FROM public.page_views_human WHERE created_at >= v_from GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Add only fingerprints first seen in this window, instead of recomputing a
  -- 9.2s DISTINCT over every human row.
  INSERT INTO public.page_view_fingerprint (fp, first_seen)
  SELECT concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,'')),
         MIN(created_at)::date
  FROM public.page_views_human
  WHERE created_at >= v_from
  GROUP BY 1
  ON CONFLICT (fp) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

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

CREATE OR REPLACE FUNCTION public.get_referrer_breakdown()
 RETURNS TABLE(source text, count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT key_1 AS source, SUM(views)::bigint AS count
  FROM public.page_view_rollup
  WHERE dimension = 'referrer'
  GROUP BY key_1
  ORDER BY 2 DESC;
$function$;
