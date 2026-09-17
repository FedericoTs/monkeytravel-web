-- page_views: correct the history the prefetch bug wrote, and a burst rule for
-- the fleet that survived the fix (2026-09-17).
--
-- WHAT HAPPENED
-- Until the deploy of 2026-09-17 17:10:36 UTC (#149) the middleware recorded
-- every Link prefetch as a page view: Next strips the Flight headers before
-- middleware runs, so the 2026-06-07 guard never fired. Two effects:
--   1. VIEWS. In a real session ~70% of rows were prefetches, in bursts a few
--      hundred milliseconds apart, all nav-menu targets. On 2026-09-16 real
--      sessions averaged 7.47 rows; dropping every row that follows another row
--      of the same session within 500 ms leaves 2.35, which is what sessions
--      look like after the fix.
--   2. SESSIONS. Prefetches fired in parallel with the first document response,
--      before the mt_session_id cookie landed, so each was minted its own
--      session id. Such phantom sessions (every row with an on-site referrer,
--      at most 8 rows, all within 3 seconds, never signed in) were 251 of 981
--      human sessions on 2026-09-15 and 296 of 1,014 on 2026-09-16.
-- Left alone, every dashboard shows views falling to a third and sessions by a
-- quarter on 2026-09-17, and every week-over-week read is wrong for a month.
--
-- WHAT THIS DOES
--   - page_views.is_prefetch: a flag, not a delete. flag_prefetch_rows() sets it
--     for rows before the deploy that follow another row of the same session
--     within 500 ms. One row per burst survives; which one is arbitrary, so
--     path-level numbers are approximate, session-level ones are not. Run it
--     in windows after the migration (see the PR).
--   - page_views_human also excludes is_prefetch rows; a new covering index
--     keeps its window scans index-only (the old index did not carry the
--     column, and a heap fetch per row is the ~4 s scan the index exists to
--     avoid).
--   - label_automation_sessions() gains two rules:
--       phantom_prefetch  the phantom-session shape above, days before the
--                         fix only (after it, no prefetch reaches the table).
--       document_burst    10+ rows inside one 30-second window, rows after the
--                         fix only. Once prefetches are gone no person produces
--                         that; the Singapore fleet does (70 rows in 15 s the
--                         evening of the deploy). Before the fix 1,218 of 4,035
--                         session-days would match because of prefetch, which
--                         is why the rule is fenced to post-fix rows.
--     Both label the session-day as excluded from page_views_human, which is
--     what the label table is for. is_automation stays the column name; the
--     reason says which it was.
--
-- The labeller keeps reading raw rows (prefetch included) for the days before
-- the fix, so the thresholds calibrated on those days keep meaning what they
-- meant. LABEL, NEVER BLOCK. Nothing here refuses a request.

alter table public.page_views
  add column if not exists is_prefetch boolean not null default false;

comment on column public.page_views.is_prefetch is
  'True for rows the middleware recorded from Link prefetches before 2026-09-17 17:10 UTC (a row that follows another row of the same session within 500 ms). Set by flag_prefetch_rows(); excluded from page_views_human. Rows after the fix are never prefetches.';

-- Covering index with the new predicate so the human view stays index-only.
create index if not exists idx_page_views_human_cover_v2
  on public.page_views using btree (created_at)
  include (session_id, user_id, path)
  where is_bot = false and is_prefetch = false;

create or replace view public.page_views_human as
  select id, path, referrer, country, country_code, city, region, latitude, longitude,
         user_agent, user_id, session_id, created_at, is_bot
  from public.page_views p
  where is_bot = false
    and is_prefetch = false
    and not exists (
      select 1 from public.page_view_session_labels l
      where l.session_id = p.session_id and l.day = p.created_at::date and l.is_automation
    );

-- One-off correction, run in windows (a week at a time keeps it well inside a
-- statement timeout on the Nano). Idempotent: already-flagged rows are skipped.
create or replace function public.flag_prefetch_rows(p_from timestamptz, p_to timestamptz)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff constant timestamptz := timestamptz '2026-09-17 17:10:36+00'; -- #149 live
  v_to timestamptz := least(p_to, v_cutoff);
  v_n bigint := 0;
begin
  if p_from >= v_to then return 0; end if;

  with ordered as (
    select id,
           created_at - lag(created_at) over (partition by session_id order by created_at, id) as gap
    from public.page_views
    where created_at >= p_from - interval '1 second'   -- the previous row may sit just before the window
      and created_at < v_to
      and session_id is not null
  )
  update public.page_views p
     set is_prefetch = true
    from ordered o
   where o.id = p.id
     and o.gap < interval '500 milliseconds'
     and p.created_at >= p_from
     and not p.is_prefetch;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke execute on function public.flag_prefetch_rows(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.flag_prefetch_rows(timestamptz, timestamptz) to service_role;

create or replace function public.label_automation_sessions(p_days integer default 3)
returns table (days_labelled integer, sessions_labelled bigint, views_labelled bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := current_date - greatest(p_days, 1);
  v_engaged_from constant date := date '2026-09-02';                       -- session_engagement begins here
  v_fix constant timestamptz := timestamptz '2026-09-17 17:10:36+00';     -- prefetch rows stop here (#149)
begin
  delete from public.page_view_session_labels where day >= v_from;

  with wiz as (
    select distinct session_id, created_at::date as day
    from public.wizard_step_events
    where created_at >= v_from
  ),
  base as (
    select p.session_id,
           p.created_at::date                as day,
           coalesce(p.city, '?')             as city,
           coalesce(p.user_agent, '?')       as ua,
           -- One family per browser build line: the version is what a
           -- rotating pool changes between sessions.
           regexp_replace(
             regexp_replace(coalesce(p.user_agent, '?'), 'Chrome/\d+(\.\d+)*', 'Chrome/x'),
             'Version/\d+(\.\d+)*', 'Version/x')     as ua_family,
           max((regexp_match(coalesce(p.user_agent, ''), 'Chrome/(\d+)'))[1]::int) as chrome_major,
           count(*)::int                     as views,
           bool_or(e.session_id is not null) as engaged,
           bool_or(p.user_id is not null)    as signed_in,
           bool_or(w.session_id is not null) as wizard
    from public.page_views p
    left join public.session_engagement e on e.session_id = p.session_id
    left join wiz w on w.session_id = p.session_id and w.day = p.created_at::date
    where p.created_at >= v_from
      and coalesce(p.is_bot, false) = false
    group by 1, 2, 3, 4, 5
  ),
  grp as (
    select day, city, ua,
           count(*)                                          as sessions,
           sum(views)                                        as views,
           avg(views)                                        as avg_views,
           avg(case when engaged then 1.0 else 0.0 end)      as engaged_share
    from base
    group by 1, 2, 3
  ),
  fam as (
    select day, city, ua_family,
           count(*)                                          as sessions,
           sum(views)                                        as views,
           avg(views)                                        as avg_views,
           avg(case when engaged then 1.0 else 0.0 end)      as engaged_share,
           bool_or(signed_in)                                as any_signed_in,
           bool_or(wizard)                                   as any_wizard
    from base
    group by 1, 2, 3
  ),
  -- ua_lagging_fleet: the exact string across the whole day, no city split.
  uageo as (
    select created_at::date as day, coalesce(user_agent, '?') as ua,
           count(distinct country_code) as countries
    from public.page_views
    where created_at >= v_from and coalesce(is_bot, false) = false
    group by 1, 2
  ),
  uag as (
    select b.day, b.ua,
           count(*)                                          as sessions,
           avg(b.views)                                      as avg_views,
           bool_or(b.signed_in)                              as any_signed_in,
           max(b.chrome_major)                               as chrome_major,
           coalesce(max(g.countries), 0)                     as countries
    from base b
    left join uageo g on g.day = b.day and g.ua = b.ua
    group by 1, 2
  ),
  daymax as (
    -- The newest Chrome major that day among strings with >= 20 sessions, so
    -- one spoofed "Chrome/999" session cannot move the bar.
    select day, max(chrome_major) as max_chrome
    from uag
    where sessions >= 20 and chrome_major between 1 and 300
    group by 1
  ),
  -- phantom_prefetch: the whole session is prefetches whose document landed in
  -- another session (the cookie race). Days before the fix only.
  phantom as (
    select session_id, created_at::date as day, count(*)::int as views
    from public.page_views
    where created_at >= v_from and created_at < v_fix
      and coalesce(is_bot, false) = false and session_id is not null
    group by 1, 2
    having bool_and(coalesce(referrer, '') ~ '^https?://(www\.)?monkeytravel\.app')
       and count(*) <= 8
       and max(created_at) - min(created_at) < interval '3 seconds'
       and bool_and(user_id is null)
  ),
  -- document_burst: 10+ rows inside one 30-second window, rows after the fix
  -- only. With prefetches gone no person produces that.
  burst as (
    select session_id, day, sum(n)::int as views
    from (
      select session_id, created_at::date as day,
             floor(extract(epoch from created_at) / 30)::bigint as bucket,
             count(*) as n, bool_or(user_id is not null) as signed_in
      from public.page_views
      where created_at >= greatest(v_from::timestamptz, v_fix)
        and coalesce(is_bot, false) = false and session_id is not null
      group by 1, 2, 3
    ) x
    group by 1, 2
    having max(n) >= 10 and not bool_or(signed_in)
  ),
  candidates as (
    select session_id, day, views, 'phantom_prefetch'::text as reason, 0 as pri
    from phantom
    union all
    select session_id, day, views, 'document_burst', 1
    from burst
    union all
    select session_id, day, views, 'heavy_unengaged', 2
    from base
    where day >= v_engaged_from and views >= 50 and not engaged and not signed_in
    union all
    select b.session_id, b.day, b.views, 'ua_city_sweep', 3
    from base b
    join grp g on g.day = b.day and g.city = b.city and g.ua = b.ua
    where b.day >= v_engaged_from and not b.engaged
      and g.sessions >= 15 and g.views >= 100 and g.engaged_share <= 0.03
    union all
    select b.session_id, b.day, b.views, 'ua_family_sweep', 4
    from base b
    join fam f on f.day = b.day and f.city = b.city and f.ua_family = b.ua_family
    where b.day >= v_engaged_from and not b.engaged
      and f.sessions >= 15 and f.views >= 100 and f.engaged_share <= 0.03
    union all
    select b.session_id, b.day, b.views, 'family_conversionless', 5
    from base b
    join fam f on f.day = b.day and f.city = b.city and f.ua_family = b.ua_family
    where f.sessions >= 15 and f.views >= 100 and f.avg_views >= 8
      and not f.any_signed_in and not f.any_wizard
    union all
    select b.session_id, b.day, b.views, 'ua_lagging_fleet', 6
    from base b
    join uag u on u.day = b.day and u.ua = b.ua
    left join daymax d on d.day = b.day
    where u.sessions >= 100
      and not u.any_signed_in
      and (
        (u.chrome_major is not null and d.max_chrome is not null
          and u.chrome_major <= d.max_chrome - 5)
        or u.avg_views <= 1.2
        or u.countries >= 40
      )
    union all
    select session_id, day, views, 'stale_chrome', 7
    from base
    where chrome_major < 120 and not signed_in
    union all
    select b.session_id, b.day, b.views, 'legacy_sweep', 8
    from base b
    join grp g on g.day = b.day and g.city = b.city and g.ua = b.ua
    where b.day < v_engaged_from
      and g.sessions >= 100 and g.avg_views >= 5
  ),
  ranked as (
    select session_id, day, views, reason,
           row_number() over (partition by session_id, day order by pri) as rn
    from candidates
  ),
  ins as (
    insert into public.page_view_session_labels (session_id, day, is_automation, reason, views)
    select session_id, day, true, reason, views
    from ranked
    where rn = 1
    on conflict (session_id, day) do nothing
    returning views
  )
  select (current_date - v_from + 1)::int, count(*), coalesce(sum(ins.views), 0)::bigint
    into days_labelled, sessions_labelled, views_labelled
  from ins;

  return next;
end
$$;

comment on function public.label_automation_sessions(integer) is
  'Rebuilds page_view_session_labels for the last p_days. Rules, first match wins: phantom_prefetch (before 2026-09-17 17:10 UTC: a session that is only on-site-referrer rows, <= 8 of them within 3 s, never signed in — prefetches whose document landed in another session), document_burst (after that time: 10+ rows in one 30-second window, not signed in), heavy_unengaged, ua_city_sweep, ua_family_sweep, family_conversionless, ua_lagging_fleet, stale_chrome, legacy_sweep. Engaged sessions are labelled only by phantom_prefetch, document_burst, family_conversionless, ua_lagging_fleet and stale_chrome; a signed-in session is never labelled.';

comment on table public.page_view_session_labels is
  'One row per (session, UTC day) excluded from page_views_human: automation presenting as a browser, or (phantom_prefetch) a session that was only the prefetch bug. Rebuilt nightly by label_automation_sessions(). reason ∈ phantom_prefetch | document_burst | heavy_unengaged | ua_city_sweep | ua_family_sweep | family_conversionless | ua_lagging_fleet | stale_chrome | legacy_sweep. Labelling only — nothing is blocked.';

revoke execute on function public.label_automation_sessions(integer) from public, anon, authenticated;
grant execute on function public.label_automation_sessions(integer) to service_role;
