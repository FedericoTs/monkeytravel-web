-- page_view_fingerprint stored each visitor fingerprint (user agent, country
-- and city run together) as the full string, though it is only ever counted.
-- It now stores that string's md5 as a uuid: 16 bytes instead of the string,
-- with the same rows and the same count.
--
-- refresh_page_view_rollup hashes the same string, so a visitor counted
-- before still matches.

-- Converting the column rewrites the table; give up rather than queue the
-- nightly rollup behind it.
set local lock_timeout = '3s';

do $$
begin
  if (select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = 'public.page_view_fingerprint'::regclass and attname = 'fp') = 'text' then
    alter table public.page_view_fingerprint alter column fp type uuid using md5(fp)::uuid;
  end if;
end
$$;

-- Unchanged except that the fingerprint insert hashes the string.
create or replace function public.refresh_page_view_rollup(p_days integer default 3)
returns table(days_rebuilt integer, rows_written bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views)
  SELECT created_at::date, 'referrer', public.referrer_source(referrer), '', COUNT(*)
  FROM public.page_views_human WHERE created_at >= v_from GROUP BY 1, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Entry channel: one row per session, attributed to the session's FIRST
  -- view. `views` counts sessions here (a session enters once);
  -- `unique_visitors` counts those that reached /trips/new in the same
  -- session, so the panel can show arrival and first activation together.
  -- A session that spans midnight is counted on the day it started.
  INSERT INTO public.page_view_rollup (day, dimension, key_1, key_2, views, unique_visitors)
  SELECT entry.day,
         'entry_channel',
         entry.channel,
         entry.section,
         COUNT(*),
         COUNT(*) FILTER (WHERE reached.session_id IS NOT NULL)
  FROM (
    SELECT DISTINCT ON (pv.session_id)
           pv.session_id,
           pv.created_at::date AS day,
           public.acquisition_channel(pv.referrer) AS channel,
           CASE
             WHEN pv.path ~ '^/(es|it|pt)?/?$' THEN 'landing'
             WHEN pv.path LIKE '%/trips%' THEN 'trips'
             WHEN pv.path LIKE '%/blog%' THEN 'blog'
             WHEN pv.path LIKE '%/destinations%' THEN 'destinations'
             WHEN pv.path ~ '/(trip|shared)/' THEN 'shared trip'
             ELSE 'other'
           END AS section
    FROM public.page_views_human pv
    WHERE pv.created_at >= v_from
    ORDER BY pv.session_id, pv.created_at
  ) entry
  LEFT JOIN (
    SELECT DISTINCT session_id
    FROM public.page_views_human
    WHERE created_at >= v_from AND path LIKE '%/trips/new%'
  ) reached ON reached.session_id = entry.session_id
  GROUP BY 1, 2, 3, 4;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.page_view_fingerprint (fp, first_seen)
  SELECT md5(concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,'')))::uuid,
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
