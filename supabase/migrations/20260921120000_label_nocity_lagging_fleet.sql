-- Label the rotating no-city fleet (2026-09-21).
--
-- A pool of Singapore sessions on Chrome/130-135 (21 user-agent strings, city
-- NULL on the geo lookup, referrer exactly https://www.google.com/, 1.06 views
-- per session, 0 signed in) grew from 5/day on Sep 15 to 160-300/day and
-- doubled the 'Google sessions' series read on 2026-09-21. Every existing rule
-- keys on one exact user-agent string or one (city, UA) group, so a pool that
-- rotates its string and carries no city never reaches a threshold. The same
-- shape ran Aug 23-30 (35-83/day) unlabelled.
--
-- New rule nocity_lagging_fleet, priority between ua_lagging_fleet and
-- stale_chrome: a session with no city, a Chrome major 15 or more behind the
-- day's newest, exactly one view and no sign-in, on a day when 30 or more such
-- sessions came from the same country. Session-level on purpose: the same
-- (day, country, no-city) bucket also holds a heavier lagging pool the older
-- rules already catch, and a group average would have swept real multi-view
-- visitors in with it. Replayed read-only over Aug 19 - Sep 21: 1,328 sessions
-- (667 already labelled by older rules, so the rules agree where they overlap),
-- 8 with a wizard event, 2 engaged; Google landings excluding them come out
-- flat at 153-245/day, which is the series the read on 2026-09-21 needed.
--
-- Labelling only. Nothing is blocked, rate-limited or served differently.

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
           coalesce(p.country_code, '?')     as country,
           bool_or(p.city is not null)       as has_city,
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
    group by 1, 2, 3, 4, 6, 7
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
  -- nocity_lagging_fleet: a pool that rotates its user-agent string, so no
  -- single string reaches the ua_lagging_fleet bar, but whose sessions share
  -- four things no person shares at once: no city on the geo lookup, a Chrome
  -- major 15+ behind the day's newest, exactly one view, never signed in.
  -- Found 2026-09-21 as a Singapore Chrome/130-135 pool (21 strings, referrer
  -- exactly google.com) that had inflated 'Google sessions' 2x since Sep 15;
  -- the same shape ran Aug 23-30. The pool is counted per (day, country) over
  -- those one-view sessions only, so a heavy visitor who happens to share the
  -- country and a missing city never moves the bar and is never labelled.
  lone as (
    select b.session_id, b.day, b.country, b.views
    from base b
    join daymax d on d.day = b.day
    where not b.has_city
      and b.chrome_major is not null
      and b.chrome_major <= d.max_chrome - 15
      and b.views = 1
      and not b.signed_in
  ),
  lonepool as (
    select day, country, count(*) as sessions
    from lone
    group by 1, 2
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
    select l.session_id, l.day, l.views, 'nocity_lagging_fleet', 7
    from lone l
    join lonepool p on p.day = l.day and p.country = l.country
    where p.sessions >= 30
    union all
    select session_id, day, views, 'stale_chrome', 8
    from base
    where chrome_major < 120 and not signed_in
    union all
    select b.session_id, b.day, b.views, 'legacy_sweep', 9
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
  'Rebuilds page_view_session_labels for the last p_days. Rules, first match wins: phantom_prefetch (before 2026-09-17 17:10 UTC: a session that is only on-site-referrer rows, <= 8 of them within 3 s, never signed in — prefetches whose document landed in another session), document_burst (after that time: 10+ rows in one 30-second window, not signed in), heavy_unengaged, ua_city_sweep, ua_family_sweep, family_conversionless, ua_lagging_fleet, nocity_lagging_fleet (a one-view, never-signed-in session with no city and a Chrome major 15+ behind the day''s newest, on a day when 30+ such sessions came from its country), stale_chrome, legacy_sweep. Engaged sessions are labelled only by phantom_prefetch, document_burst, family_conversionless, ua_lagging_fleet, nocity_lagging_fleet and stale_chrome; a signed-in session is never labelled.';

comment on table public.page_view_session_labels is
  'One row per (session, UTC day) excluded from page_views_human: automation presenting as a browser, or (phantom_prefetch) a session that was only the prefetch bug. Rebuilt nightly by label_automation_sessions(). reason ∈ phantom_prefetch | document_burst | heavy_unengaged | ua_city_sweep | ua_family_sweep | family_conversionless | ua_lagging_fleet | nocity_lagging_fleet | stale_chrome | legacy_sweep. Labelling only — nothing is blocked.';

revoke execute on function public.label_automation_sessions(integer) from public, anon, authenticated;
grant execute on function public.label_automation_sessions(integer) to service_role;
