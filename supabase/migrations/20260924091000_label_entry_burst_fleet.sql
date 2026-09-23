-- Label the burst sitemap crawler (2026-09-24).
--
-- On 2026-09-23 about 1,200 of the day's ~1,600 "human" sessions were one
-- crawler: four bursts on a ~3-hour cadence, one page per session, no
-- referrer, no sign-in, desktop Chrome/136-142 spread over 21-27 exact
-- user-agent strings so that no single string reached ua_lagging_fleet's
-- 100-session bar. No rule matched it, so unlike the fleets the nightly job
-- mops up, it would have stayed in the series and rollups for good.
--
-- New rule entry_burst_fleet (priority 11): a one-view, no-referrer,
-- never-signed-in desktop Chrome session at least 5 majors behind the day's
-- newest, with no engagement, consent, wizard or funnel row, opened inside a
-- 15-minute window that holds 60+ such sessions on 95%+ distinct paths.
-- Rehearsed read-only over 17-23 Sep: fires only on 23 Sep (7 buckets,
-- 68-342 sessions each, 99-100% distinct paths); the one other 60+ bucket
-- (18 Sep 18:30, 74% distinct, led by /trips/new) was real people and is
-- left alone.
--
-- Sixth change to the definition of a human session since 27 August
-- (fc2b4b6, 3ac47c4, #149, #168, #173, this). It moves only 23 Sep today.
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
  -- cookieless_internal_entry (2026-09-23): the continuation of
  -- phantom_prefetch past its fence, not a new population.
  --
  -- phantom_prefetch labels "a session that is only on-site-referrer rows,
  -- <= 8 of them within 3 s, never signed in". A ONE-ROW session satisfies
  -- all three trivially, so until v_fix that rule was absorbing 216-624 of
  -- these a day (14 Sep 216, 15th 624, 16th 299, 17th 575, 18th onward 0).
  -- It is fenced to pre-fix rows, so from 18 September the same sessions
  -- reappeared inside page_views_human at 164-207/day, 19-31% of the human
  -- series. The step UP in sessions/day on 18 September is that, not growth.
  --
  -- What they are: one-shot requests carrying a same-origin Referer for a
  -- page the client never fetched. Measured 2026-09-20 on 168 of them, 1
  -- (0.6%) has another session viewing the referrer's path with the same
  -- user-agent within the preceding 30 minutes; the identical matcher run
  -- against genuine internal-referrer rows that are NOT a session's first
  -- row finds the predecessor 145 times out of 161 (90%). The matcher works;
  -- the predecessor does not exist. Over 18-21 Sep, 605 such sessions carry
  -- 456 distinct user-agent strings (0.754 per session, against 0.191 for
  -- every other human session) across 78 countries, and 5 of 605 (0.8%)
  -- left any client-side row at all.
  --
  -- A real person who blocks cookies is NOT this: they still run our JS, so
  -- they still write session_engagement and consent_events rows. Measured
  -- independently: 249 banner impressions in 7 days arrive with session_id
  -- NULL (5.3% of impressions) and none of them is in this set.
  --
  -- LABEL, NEVER BLOCK. page_views keeps every row; only the human view and
  -- the rollups built on it change.
  lonely as (
    select p.session_id,
           p.created_at::date as day,
           min(p.path)        as path,      -- one-row group: min() IS that row
           count(*)::int      as views
    from public.page_views p
    where p.created_at >= greatest(v_from::timestamptz, v_fix)
      and coalesce(p.is_bot, false) = false
      and coalesce(p.is_prefetch, false) = false
      and p.session_id is not null
    group by 1, 2
    having count(*) = 1
       and bool_and(p.user_id is null)
       and bool_and(coalesce(p.referrer, '') ~ '^https?://(www\.)?monkeytravel\.app(/|$)')
  ),
  lonely_kept as (
    select l.session_id, l.day, l.views
    from lonely l
    where
      -- (1) NEVER label away our own defect. Until 2026-09-22 a middleware
      -- redirect returned a fresh NextResponse and dropped the Set-Cookie,
      -- so the view was written under a session id nobody kept: ~14/day on
      -- protected /trips* and on /auth/login|signup. Those orphans must stay
      -- visible, or the label hides the bug. Mirrors that branch's own path
      -- test. /admin needs no clause: the classifier returns skip:path.
      not (
            regexp_replace(l.path, '^/(en|es|it|pt)(?=/|$)', '') ~  '^/trips(/|$)'
        and regexp_replace(l.path, '^/(en|es|it|pt)(?=/|$)', '') !~ '^/trips/new(/|$)'
        and regexp_replace(l.path, '^/(en|es|it|pt)(?=/|$)', '') !~ '^/trips/template(/|$)'
        and regexp_replace(l.path, '^/(en|es|it|pt)(?=/|$)', '')
              !~ '^/trips/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)'
      )
      and regexp_replace(l.path, '^/(en|es|it|pt)(?=/|$)', '') !~ '^/auth/(login|signup)(/|$)'
      -- (2) any sign the client ran our JavaScript and echoed the cookie
      -- back. All four routes read mt_session_id off the request, so a row
      -- here PROVES a cookie-keeping browser.
      and not exists (select 1 from public.session_engagement e where e.session_id = l.session_id)
      and not exists (select 1 from public.consent_events     c where c.session_id = l.session_id)
      and not exists (select 1 from public.wizard_step_events w where w.session_id = l.session_id)
      and not exists (select 1 from public.funnel_events      f where f.session_id = l.session_id)
      -- (3) not a real visit spanning midnight, which presents an internal
      -- first row on day 2. Scoped to the labelled window: page_views has no
      -- index on session_id alone and an unbounded lookback hits the
      -- statement timeout. Measured 0 of 168 on 2026-09-20, so this is a
      -- belt rather than the argument.
      and not exists (select 1 from base   b2 where b2.session_id = l.session_id and b2.day < l.day)
      and not exists (select 1 from lonely l2 where l2.session_id = l.session_id and l2.day < l.day)
  ),
  lonely_pool as (
    select day, count(*) as sessions from lonely_kept group by 1
  ),
  -- entry_burst_fleet (2026-09-24): a sitemap crawler on rotating desktop
  -- Chrome user-agents. On 23 Sep it arrived in bursts at a ~3-hour cadence
  -- (06:00, 08:40, 11:40, 14:40 UTC) and was ~72% of that day's "human"
  -- sessions: one view each, no referrer, never signed in, walking the
  -- sitemap in order (/destinations, /blog, /blog/tag, /about/authors,
  -- /creator). It spreads over 21-27 exact UA strings, at most 69 sessions
  -- each, so ua_lagging_fleet (>= 100 per exact UA) never reaches it; the
  -- cities resolve, so nocity_lagging_fleet misses it; it sends no referrer,
  -- so cookieless_internal_entry misses it.
  --
  -- The signature is the BUCKET, not the session: 60+ such sessions opened
  -- inside one 15-minute window AND 95%+ of them on distinct paths. The path
  -- test is what separates a crawl from people. Rehearsed on 17-23 Sep: every
  -- crawl bucket on 23 Sep is 99-100% distinct paths (68-342 sessions); the
  -- only other bucket over 60, on 18 Sep 18:30, was 74% distinct and led by
  -- /es/trips/new and /trips/new — real visitors, and not labelled.
  --
  -- LABEL, NEVER BLOCK.
  burstcand as (
    select p.session_id,
           p.created_at::date as day,
           min(p.created_at)  as first_at,
           min(p.path)        as path,      -- one-row group: min() IS that row
           max((regexp_match(coalesce(p.user_agent, ''), 'Chrome/(\d+)'))[1]::int) as chrome_major,
           count(*)::int      as views
    from public.page_views p
    where p.created_at >= greatest(v_from::timestamptz, v_fix)
      and coalesce(p.is_bot, false) = false
      and coalesce(p.is_prefetch, false) = false
      and p.session_id is not null
    group by 1, 2
    having count(*) = 1
       and bool_and(p.user_id is null)
       and bool_and(coalesce(p.referrer, '') = '')
       and bool_and(coalesce(p.user_agent, '') ~ 'Chrome/\d+'
                    and coalesce(p.user_agent, '') !~* '(Mobile|Android|iPhone|iPad)')
  ),
  burstkept as (
    select c.session_id, c.day, c.views, c.path,
           date_trunc('hour', c.first_at)
             + floor(extract(minute from c.first_at) / 15) * interval '15 minutes' as bucket
    from burstcand c
    join daymax d on d.day = c.day
    where c.chrome_major <= d.max_chrome - 5
      -- any sign the client ran our JavaScript exempts it
      and not exists (select 1 from public.session_engagement e where e.session_id = c.session_id)
      and not exists (select 1 from public.consent_events     x where x.session_id = c.session_id)
      and not exists (select 1 from public.wizard_step_events w where w.session_id = c.session_id)
      and not exists (select 1 from public.funnel_events      f where f.session_id = c.session_id)
  ),
  burstpool as (
    select bucket,
           count(*)                                            as sessions,
           count(distinct path)::numeric / nullif(count(*), 0) as distinct_share
    from burstkept
    group by 1
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
    union all
    -- Priority 10, deliberately LAST. Priority decides only which reason is
    -- recorded, never whether a session-day is excluded (that is the union),
    -- and this is the weakest-evidence rule in the set: it keys on a referrer
    -- string and a view count, not on a fleet signature. Going last means it
    -- claims only what no stronger rule claimed, so the nightly delta reads
    -- directly as "sessions this rule added".
    --
    -- The day floor mirrors nocity_lagging_fleet: a handful on a quiet day is
    -- likelier a real cookie-blocked person than a pool. At 164-207/day it
    -- never binds today; it exists so the rule switches itself off if the
    -- population ever collapses.
    select k.session_id, k.day, k.views, 'cookieless_internal_entry', 10
    from lonely_kept k
    join lonely_pool p on p.day = k.day
    where p.sessions >= 30
    union all
    -- Disjoint from cookieless_internal_entry (that one requires a
    -- same-origin referrer, this one requires none), so its place in the
    -- order only sets the recorded reason.
    select k.session_id, k.day, k.views, 'entry_burst_fleet', 11
    from burstkept k
    join burstpool p on p.bucket = k.bucket
    where p.sessions >= 60 and p.distinct_share >= 0.95
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
  'Rebuilds page_view_session_labels for the last p_days. Rules, first match wins: phantom_prefetch (before 2026-09-17 17:10 UTC), document_burst, heavy_unengaged, ua_city_sweep, ua_family_sweep, family_conversionless, ua_lagging_fleet, nocity_lagging_fleet, stale_chrome, legacy_sweep, cookieless_internal_entry (a one-row anonymous session whose only view carries a monkeytravel referrer and left no engagement/consent/wizard/funnel row, on a day with 30+ such sessions; protected /trips* and /auth/login|signup exempt), entry_burst_fleet (a one-row, no-referrer, never-signed-in desktop Chrome session 5+ majors behind the day''s newest, with no engagement/consent/wizard/funnel row, in a 15-minute window of 60+ such sessions on 95%+ distinct paths). A signed-in session is never labelled.';

revoke execute on function public.label_automation_sessions(integer) from public, anon, authenticated;
grant execute on function public.label_automation_sessions(integer) to service_role;
