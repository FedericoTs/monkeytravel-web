-- Acquisition measured from our own first-party page views, per SESSION ENTRY.
--
-- WHY
-- ---
-- GA4 stopped being a usable acquisition view on 2026-09-01, when c17abc3
-- made the tags obey the cookie banner. Measured over the seven days to
-- 2026-09-22: of 4,636 banner impressions, 141 accepted (3.0%). So GA4 now
-- sees ~3 visitors in 100 and its channel chart reads like a collapse that
-- did not happen — first-party human sessions were flat across the same
-- period (600-850/day) and Google-referred sessions rose to 241-245/day on
-- 20-21 September.
--
-- page_views is first-party, cookieless, aggregate and never leaves us, so it
-- answers "where did people come from" without a consent gate. What it could
-- not answer until now is the question in that shape:
--
--   1. get_referrer_breakdown() has NO date window. It sums page_view_rollup
--      from the beginning of time, so it can state a share but never a trend,
--      and every new day barely moves it.
--   2. It counts VIEWS, so one reader working through twelve blog pages
--      outweighs twelve arrivals. Acquisition is an arrival count.
--   3. referrer_source() has no bucket for AI assistants. ChatGPT, Perplexity,
--      Gemini and Copilot referrals all land in 'other' — the one channel GA4
--      breaks out on its own, and the one we most need to watch.
--
-- WHAT THIS ADDS
-- --------------
-- * acquisition_channel(text) — the taxonomy above, with ai_assistant and
--   other_search as first-class buckets. referrer_source() is left alone: the
--   existing 'referrer' rollup rows keep their meaning, and nothing that reads
--   them changes underneath.
-- * an 'entry_channel' dimension on page_view_rollup, written from the FIRST
--   view of each session: key_1 = channel, key_2 = entry section, views =
--   number of sessions that entered there (NOT page views — this is the one
--   dimension in the table where that column counts sessions, because a
--   session enters exactly once). unique_visitors carries the sessions that
--   went on to reach the wizard, so acquisition and its first activation step
--   sit in one row.
-- * get_acquisition_breakdown(p_days) — day-windowed, session-based, with the
--   two follow-through counts.
--
-- 'internal' is kept as its own visible bucket rather than folded into direct.
-- It is 21.7% of entry sessions in the last 7 days, which is a session
-- stitching artifact (a session whose first RECORDED view already carries a
-- monkeytravel referrer), and hiding it inside 'direct' would overstate direct
-- by a fifth. Better a visible "continuation" row that invites the fix.

create or replace function public.acquisition_channel(p_referrer text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_referrer is null or p_referrer = '' then 'direct'
    when p_referrer like '%monkeytravel.app%' then 'internal'
    when p_referrer like '%vercel.app%' or p_referrer like '%localhost%' then 'dev'
    -- Before the search engines: Gemini and Copilot live on google.com and
    -- bing.com hosts, so a plain '%google%' test would swallow them.
    when p_referrer ~* '(chatgpt|openai|perplexity|claude\.ai|copilot|gemini\.google|bard\.google|you\.com|phind)' then 'ai_assistant'
    when p_referrer like '%google%' then 'google'
    when p_referrer like '%bing%' then 'bing'
    when p_referrer ~* '(duckduckgo|ecosia|yahoo|brave\.com|startpage|qwant|search\.marginalia)' then 'other_search'
    when p_referrer ~* '(facebook|fb\.com|fbclid|instagram|t\.co/|twitter|x\.com|linkedin|reddit|youtube|tiktok|pinterest|whatsapp|telegram)' then 'social'
    else 'other'
  end;
$$;

comment on function public.acquisition_channel(text) is
  'Entry-channel taxonomy for first-party acquisition. AI assistants are tested BEFORE google/bing because Gemini and Copilot referrals carry those hosts.';

-- The rollup gains one dimension. Everything already in the function is
-- unchanged; this is appended before the meta row is written.
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

-- Windowed, session-based, with the follow-through count. Reads the rollup,
-- never page_views, so it answers in milliseconds and cannot hit PostgREST's
-- 8s ceiling the way a live aggregate over page_views would.
--
-- NO PERIOD-OVER-PERIOD COMPARISON, DELIBERATELY
-- ----------------------------------------------
-- The first draft returned the previous equal-length window beside the
-- current one. Rehearsed on live data it claimed google entry sessions were
-- up 1,162% and direct up 351%, which is false: what changed was the
-- DEFINITION of a human session, four times in four weeks (insert-time bot
-- detection fc2b4b6 on 27 Aug, 3ac47c4 on 2 Sep, the Flight-header fix in
-- #149 on 17 Sep, the self-naming tools and nocity_lagging_fleet in #168 on
-- 21 Sep). page_views_human is recomputed with today's rules whenever the
-- rollup is rebuilt, so any window spanning those dates compares two
-- different measurements and a single percentage hides that completely.
-- A per-day series does not: a step in the line is visible as a step. Use
-- get_acquisition_trend() for movement, this for composition.
create or replace function public.get_acquisition_breakdown(p_days integer default 28)
returns table(
  channel text,
  entry_sessions bigint,
  reached_wizard bigint,
  wizard_pct numeric,
  share_pct numeric
)
language sql
stable
set search_path to 'public'
as $$
  with window_rows as (
    select key_1 as channel, sum(views)::bigint as entry_sessions,
           sum(coalesce(unique_visitors, 0))::bigint as reached_wizard
    from public.page_view_rollup
    where dimension = 'entry_channel'
      and day >= (current_date - greatest(p_days, 1))
    group by 1
  )
  select channel,
         entry_sessions,
         reached_wizard,
         round(100.0 * reached_wizard / nullif(entry_sessions, 0), 1) as wizard_pct,
         round(100.0 * entry_sessions / nullif(sum(entry_sessions) over (), 0), 1) as share_pct
  from window_rows
  order by entry_sessions desc;
$$;

comment on function public.get_acquisition_breakdown(integer) is
  'Entry sessions by acquisition channel for the last p_days, with the share that reached the wizard. Session-based and consent-free: reads page_view_rollup, never GA4. Returns no period-over-period delta on purpose — see the migration comment.';

-- Movement, as a series. One row per day per channel, so a change in how a
-- human session is counted shows up as a visible step rather than hiding
-- inside a single percentage.
create or replace function public.get_acquisition_trend(p_days integer default 28)
returns table(day date, channel text, entry_sessions bigint)
language sql
stable
set search_path to 'public'
as $$
  select day, key_1 as channel, sum(views)::bigint as entry_sessions
  from public.page_view_rollup
  where dimension = 'entry_channel'
    and day >= (current_date - greatest(p_days, 1))
  group by 1, 2
  order by 1, 3 desc;
$$;

comment on function public.get_acquisition_trend(integer) is
  'Daily entry sessions per channel for the last p_days. Paired with get_acquisition_breakdown so movement is read from a series, never from a cross-window percentage.';

grant execute on function public.acquisition_channel(text) to authenticated, anon, service_role;
grant execute on function public.get_acquisition_breakdown(integer) to authenticated, service_role;
grant execute on function public.get_acquisition_trend(integer) to authenticated, service_role;
