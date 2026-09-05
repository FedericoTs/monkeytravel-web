-- Phase 0.2 of docs/LIVE_TRIP_MASTER_PLAN.md — the human view learns to see
-- automation that presents as a browser.
--
-- WHAT WAS TRUE BEFORE
-- page_views_human = page_views WHERE is_bot = false, and is_bot is set only
-- from SELF-DECLARED crawler user-agents (lib/analytics/bot-detection.ts, on
-- purpose: a UA-level test cannot tell a person from a script that presents
-- Chrome). Everything downstream — page_view_rollup, get_engagement_metrics,
-- get_referrer_breakdown, the admin dashboard — read that view and inherited
-- its blind spot.
--
-- MEASURED 2026-09-04, last 7 days, is_bot = false only:
--   ~5% of session-days produced ~40% of "human" views. But a per-session
--   volume threshold is the WRONG rule: engagement (the 4-second beacon in
--   session_engagement) RISES with view count — 0.4% of 1-2-view sessions
--   engaged vs 33.9% of 50+-view sessions — so "≥20 views = bot" would mislabel
--   a third of the heaviest real users. The tell was never the individual
--   session; it was the GROUP: one city, one user-agent, hundreds of sessions
--   walking ~11 pages each, zero engagement (Cittadella, 2026-09-01: 612
--   sessions, 6,865 views, 0.0% engaged).
--
-- THE RULES, each recorded as `reason`, each measured before being written:
--   heavy_unengaged  session-day with >= 50 views that never fired the
--                    engagement beacon                      13.4% of views
--   ua_city_sweep    (day, city, user_agent) group with >= 15 sessions,
--                    >= 100 views and <= 3% engaged; only the group's
--                    UNENGAGED members are labelled            13.8% of views
--                    together: 26.6% of views from 8.8% of session-days
--   legacy_sweep     for days BEFORE session_engagement existed (2026-09-02),
--                    "never engaged" is unknowable, so only the strict volume
--                    form applies: >= 100 sessions in one (day, city, ua)
--                    group with >= 5 views each. Over August this labels
--                    exactly three groups (a 779-session mobile-emulation
--                    crawler, its 204-session return, Cittadella) and nothing
--                    with 2-3 views per session.
--
-- A session that fired the engagement beacon is NEVER labelled, whatever
-- group it sits in. That is the one rule that protects real people.
--
-- LABEL, NEVER BLOCK. Nothing here refuses a request (standing rule,
-- 2026-09-03). Labels live in their own small table (~10k rows/day) rather
-- than as a stamped column on 700k+ page_views rows: cheap to recompute,
-- carries the reason, auditable.
--
-- The nightly job runs at 02:20 UTC, twenty minutes before the existing
-- refresh-page-view-rollup job at 02:40, so the rollup rebuilds on top of
-- fresh labels.

create table if not exists public.page_view_session_labels (
  session_id    text        not null,
  day           date        not null,
  is_automation boolean     not null default true,
  reason        text        not null,
  views         integer     not null default 0,
  labelled_at   timestamptz not null default now(),
  primary key (session_id, day)
);

comment on table public.page_view_session_labels is
  'One row per (session, UTC day) judged to be automation presenting as a browser. Rebuilt nightly by label_automation_sessions(); page_views_human excludes these. reason ∈ heavy_unengaged | ua_city_sweep | legacy_sweep. Labelling only — nothing is blocked.';

create index if not exists idx_pvsl_day on public.page_view_session_labels (day);

-- Same reach as page_views itself (authenticated may read; anon may not), so
-- the security_invoker view below resolves for every role that could already
-- read the base table, and no wider.
alter table public.page_view_session_labels enable row level security;
revoke all on public.page_view_session_labels from public, anon;
grant select on public.page_view_session_labels to authenticated, service_role;
drop policy if exists "labels readable by authenticated" on public.page_view_session_labels;
create policy "labels readable by authenticated"
  on public.page_view_session_labels for select to authenticated using (true);

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

  with base as (
    select p.session_id,
           p.created_at::date                as day,
           coalesce(p.city, '?')             as city,
           coalesce(p.user_agent, '?')       as ua,
           count(*)::int                     as views,
           bool_or(e.session_id is not null) as engaged
    from public.page_views p
    left join public.session_engagement e on e.session_id = p.session_id
    where p.created_at >= v_from
      and coalesce(p.is_bot, false) = false
    group by 1, 2, 3, 4
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
  candidates as (
    select session_id, day, views, 'heavy_unengaged'::text as reason, 1 as pri
    from base
    where day >= v_engaged_from and views >= 50 and not engaged
    union all
    select b.session_id, b.day, b.views, 'ua_city_sweep', 2
    from base b
    join grp g on g.day = b.day and g.city = b.city and g.ua = b.ua
    where b.day >= v_engaged_from and not b.engaged
      and g.sessions >= 15 and g.views >= 100 and g.engaged_share <= 0.03
    union all
    select b.session_id, b.day, b.views, 'legacy_sweep', 3
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
  'Rebuilds page_view_session_labels for the last p_days. Rules: heavy_unengaged, ua_city_sweep (both need session_engagement, i.e. days >= 2026-09-02), legacy_sweep (strict volume rule for earlier days). Engaged sessions are never labelled.';

-- SECURITY DEFINER + mutates ⇒ nobody but the scheduler may call it. Supabase
-- grants EXECUTE on new public functions to PUBLIC by default, which would let
-- anon rebuild the labels over PostgREST at will (tenant-guard: definer-grants).
-- pg_cron runs the job as the function's owner; the service role keeps EXECUTE
-- for manual backfills. REVOKE FROM PUBLIC is the one that matters — the anon
-- and authenticated grants derive from it.
revoke execute on function public.label_automation_sessions(integer) from public, anon, authenticated;
grant execute on function public.label_automation_sessions(integer) to service_role;

-- The view keeps its exact column list and security_invoker semantics; it
-- gains one predicate.
create or replace view public.page_views_human
with (security_invoker = true) as
select id, path, referrer, country, country_code, city, region, latitude, longitude,
       user_agent, user_id, session_id, created_at, is_bot
from public.page_views p
where p.is_bot = false
  and not exists (
    select 1
    from public.page_view_session_labels l
    where l.session_id = p.session_id
      and l.day = p.created_at::date
      and l.is_automation
  );

comment on view public.page_views_human is
  'page_views minus self-declared crawlers (is_bot) minus sessions labelled as automation (page_view_session_labels). The only page_views surface analytics should read. security_invoker: readers see exactly what they could read from page_views.';

-- Nightly, twenty minutes before refresh-page-view-rollup (02:40).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'label-automation-sessions') then
    perform cron.unschedule('label-automation-sessions');
  end if;
  perform cron.schedule(
    'label-automation-sessions',
    '20 2 * * *',
    'select public.label_automation_sessions(3)'
  );
end
$$;
