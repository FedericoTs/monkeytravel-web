-- Automation labels, third pass (2026-09-17): the fleet that executes JavaScript.
--
-- WHAT HAPPENED
-- On 2026-09-17 between 12:00 and 16:00 UTC one exact user-agent string
-- (Macintosh, Chrome/145) opened 2,016 sessions and 27,359 views from 107
-- countries and 711 cities, 10-99 views per session in two or three minutes.
-- It ran the page's JavaScript: it fired the consent banner's `shown` event
-- in 1,545 sessions, wizard step-1 events in ~450 and the 30-second
-- heartbeat in ~140. label_automation_sessions(1) labelled 176 of them.
--
-- Why every existing rule missed it:
--   heavy_unengaged       needs >= 50 views AND no engagement beacon; these
--                         sessions have 10-99 views and DO fire the beacon.
--   ua_city_sweep /       need >= 15 sessions and >= 100 views in ONE
--   ua_family_sweep       (day, city, UA) group; 711 cities means ~3 per city.
--   family_conversionless needs a (day, city, family) group with no wizard
--                         event; these sessions fire wizard events.
--   stale_chrome          is Chrome major < 120; this was 145.
--
-- A second, quieter fleet has been in the "human" numbers every day since
-- 2026-08-24: the exact string Macintosh Chrome/142, 100-181 sessions a day,
-- 12-25 countries, 30-52 cities, one view per session, never signed in.
-- About a tenth of daily human sessions. Same reasons, never labelled.
--
-- THE RULE  ua_lagging_fleet, per (UTC day, exact user-agent string):
--   sessions >= 100, no signed-in session in the group, and any of
--     - Chrome major <= (the day's newest Chrome major, among UA strings with
--       >= 20 sessions) - 5: a version people no longer run at that scale
--       (Chrome updates itself; mainstream lags 0-3 majors),
--     - views per session <= 1.2: a hundred people do not all bounce,
--     - >= 40 countries on one exact string.
--   Every session in the group is labelled, engaged or not, like
--   family_conversionless. Measured over the 30 days to 2026-09-17: matches
--   every fleet-shaped group (Chrome/142, /145, /147, /148, /149, Firefox Mac
--   one-hitters) and no real one - every real UA group with 100+ sessions
--   had at least one signed-in session and lagged at most 3 majors.
--
-- Velocity (views per minute) was rejected as a discriminator: until the
-- 2026-09-17 middleware fix, Link prefetches were recorded as views, so real
-- people looked like 12 views a minute too.
--
-- LABEL, NEVER BLOCK. Nothing here refuses a request (standing rule,
-- 2026-09-03). Same table, same nightly job (02:20 UTC), same view.

create or replace function public.label_automation_sessions(p_days integer default 3)
returns table (days_labelled integer, sessions_labelled bigint, views_labelled bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := current_date - greatest(p_days, 1);
  v_engaged_from constant date := date '2026-09-02'; -- session_engagement begins here
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
  candidates as (
    select session_id, day, views, 'heavy_unengaged'::text as reason, 1 as pri
    from base
    where day >= v_engaged_from and views >= 50 and not engaged and not signed_in
    union all
    select b.session_id, b.day, b.views, 'ua_city_sweep', 2
    from base b
    join grp g on g.day = b.day and g.city = b.city and g.ua = b.ua
    where b.day >= v_engaged_from and not b.engaged
      and g.sessions >= 15 and g.views >= 100 and g.engaged_share <= 0.03
    union all
    select b.session_id, b.day, b.views, 'ua_family_sweep', 3
    from base b
    join fam f on f.day = b.day and f.city = b.city and f.ua_family = b.ua_family
    where b.day >= v_engaged_from and not b.engaged
      and f.sessions >= 15 and f.views >= 100 and f.engaged_share <= 0.03
    union all
    select b.session_id, b.day, b.views, 'family_conversionless', 4
    from base b
    join fam f on f.day = b.day and f.city = b.city and f.ua_family = b.ua_family
    where f.sessions >= 15 and f.views >= 100 and f.avg_views >= 8
      and not f.any_signed_in and not f.any_wizard
    union all
    select b.session_id, b.day, b.views, 'ua_lagging_fleet', 5
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
    select session_id, day, views, 'stale_chrome', 6
    from base
    where chrome_major < 120 and not signed_in
    union all
    select b.session_id, b.day, b.views, 'legacy_sweep', 7
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
  'Rebuilds page_view_session_labels for the last p_days. Rules, first match wins: heavy_unengaged, ua_city_sweep, ua_family_sweep (version-stripped UA groups), family_conversionless (a 15+ session group with no signed-in member and no wizard event, all members), ua_lagging_fleet (one exact UA with 100+ sessions in a day, no signed-in member, and a Chrome major 5+ behind the day''s newest, or <= 1.2 views per session, or 40+ countries; all members), stale_chrome (Chrome major < 120), legacy_sweep (strict volume rule for days before session_engagement, 2026-09-02). Engaged sessions are labelled only by family_conversionless, ua_lagging_fleet and stale_chrome; a signed-in session is never labelled.';

comment on table public.page_view_session_labels is
  'One row per (session, UTC day) judged to be automation presenting as a browser. Rebuilt nightly by label_automation_sessions(); page_views_human excludes these. reason ∈ heavy_unengaged | ua_city_sweep | ua_family_sweep | family_conversionless | ua_lagging_fleet | stale_chrome | legacy_sweep. Labelling only — nothing is blocked.';

-- Grants are preserved by CREATE OR REPLACE; restated so a fresh database
-- ends up identical (tenant-guard: definer-grants).
revoke execute on function public.label_automation_sessions(integer) from public, anon, authenticated;
grant execute on function public.label_automation_sessions(integer) to service_role;
