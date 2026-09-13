-- Automation labels, second pass (2026-09-13): rotating user-agents, stale
-- Chrome, and groups that never touch the product.
--
-- WHAT THE FIRST PASS MISSED
-- 20260905090000 labels by (day, city, EXACT user-agent) group and never
-- labels a session that fired the 4-second engagement beacon. Measured over
-- 2026-08-31..09-13 that leaves a Singapore fleet inside page_views_human:
-- 14,002 "human" views from 952 sessions (14.7 views/session vs 4.8 for the
-- US), Windows desktop Chrome with the MAJOR VERSION ROTATING per session
-- (Chrome/10x, 11x, 12x, 13x), city "Singapore" or unknown, 435 sessions
-- reaching /trips/new and 11 generating. Two properties defeat the first
-- pass: the rotating version keeps every exact-UA group under the 15-session
-- floor, and the browser is patient enough to fire the engagement beacon
-- (31.5% of its old-Chrome session-days "engaged", 70 of its 87 session-days
-- with 50+ views). So neither ua_city_sweep nor heavy_unengaged ever match it.
--
-- THE NEW RULES, each measured over the same 14 days before being written:
--   ua_family_sweep       ua_city_sweep with the Chrome/Safari version
--                         stripped from the UA, so a rotating pool is one
--                         group. Same floors (>= 15 sessions, >= 100 views,
--                         <= 3% engaged), unengaged members only.
--                         Dry run: 1,672 session-days / 17,252 views, 839 of
--                         them already carrying an exact-UA label.
--   family_conversionless (day, city, UA family) group with >= 15 sessions,
--                         >= 100 views, >= 8 views per session, NO signed-in
--                         member and NO wizard_step_events from any member
--                         that day. ALL members are labelled, engaged or not.
--                         Dry run: 298 session-days / 6,197 views; every
--                         qualifying group was a crawler (the Nexus 5X
--                         mobile-emulation fleet, 87 sessions/2,845 views on
--                         09-12; Singapore Windows Chrome, 34 sessions at 21
--                         views each; Armenia, Bangladesh and China Linux/
--                         Windows pools). A real cohort of 15+ same-city,
--                         same-browser sessions averaging 8+ pages always
--                         contains someone who opens the wizard.
--   stale_chrome          Chrome major < 120 (Chrome 120 shipped 2023-12 and
--                         the browser auto-updates). Measured: 1,513
--                         session-days / 8,271 views, ZERO signed-in, 2.6%
--                         engaged outside the Singapore fleet, median
--                         session span six seconds. Labelled regardless of
--                         engagement; signed-in sessions are exempt as a
--                         guard.
--   heavy_unengaged       also gains the signed-in guard. A signed-in session is
--                         a known account, not anonymous automation: 2026-09-03
--                         had one real account with 66 views and no beacon (an
--                         ad blocker or consent choice can silence the beacon).
--
-- "An engaged session is never labelled" therefore gains two documented
-- exceptions, family_conversionless and stale_chrome, both of which require
-- a signal the beacon cannot fake: an entire group that never signs in or
-- touches the wizard, or a browser version no person runs any more.
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
    select session_id, day, views, 'stale_chrome', 5
    from base
    where chrome_major < 120 and not signed_in
    union all
    select b.session_id, b.day, b.views, 'legacy_sweep', 6
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
  'Rebuilds page_view_session_labels for the last p_days. Rules, first match wins: heavy_unengaged, ua_city_sweep, ua_family_sweep (version-stripped UA groups), family_conversionless (a 15+ session group with no signed-in member and no wizard event, all members), stale_chrome (Chrome major < 120), legacy_sweep (strict volume rule for days before session_engagement, 2026-09-02). Engaged sessions are labelled only by family_conversionless and stale_chrome; a signed-in session is never labelled.';

comment on table public.page_view_session_labels is
  'One row per (session, UTC day) judged to be automation presenting as a browser. Rebuilt nightly by label_automation_sessions(); page_views_human excludes these. reason ∈ heavy_unengaged | ua_city_sweep | ua_family_sweep | family_conversionless | stale_chrome | legacy_sweep. Labelling only — nothing is blocked.';

-- Grants are preserved by CREATE OR REPLACE; restated so a fresh database
-- ends up identical (tenant-guard: definer-grants).
revoke execute on function public.label_automation_sessions(integer) from public, anon, authenticated;
grant execute on function public.label_automation_sessions(integer) to service_role;
