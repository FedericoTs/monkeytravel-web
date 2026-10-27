-- Mission control gains Live trips: trips under way in each window, how many
-- used Today or had participants, and how many the owner opened during the
-- trip. Anonymous trips count everywhere except the owner, which they lack.

create or replace function public.mission_control(p_days integer default 7)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with bounds as (
  select now() - make_interval(days => p_days) as cur_start,
         now() - make_interval(days => 2 * p_days) as prev_start
),
steps as (
  select w.session_id, w.step, w.created_at, w.created_at >= b.cur_start as cur
  from wizard_step_events_human w, bounds b
  where w.created_at >= b.prev_start
    and w.step in ('step_1_destination_dates', 'generating', 'result', 'generation_failed', 'save_clicked', 'saved')
    and w.session_id not like 'e2eprobe-%'
),
funnel as (
  select cur, jsonb_build_object(
    'opened', count(distinct session_id) filter (where step = 'step_1_destination_dates'),
    'generating', count(distinct session_id) filter (where step = 'generating'),
    'planned', count(distinct session_id) filter (where step = 'result'),
    'failed', count(distinct session_id) filter (where step = 'generation_failed'),
    'save_clicked', count(distinct session_id) filter (where step = 'save_clicked'),
    'saved', count(distinct session_id) filter (where step = 'saved')) as j
  from steps
  group by cur
),
kept as (
  select k.created_at >= b.cur_start as cur,
         jsonb_build_object('kept', count(*), 'reopened', count(*) filter (where k.opens > 0)) as j
  from kept_plans k, bounds b
  where k.created_at >= b.prev_start
    and coalesce(k.session_id, '') not like 'e2eprobe-%'
  group by 1
),
gen as (
  select l.timestamp >= b.cur_start as cur, l.response_status, l.response_time_ms, l.cache_hit,
         (l.request_params->>'first_day_ms')::int as first_day_ms
  from api_request_logs l, bounds b
  where l.timestamp >= b.prev_start
    and l.endpoint in ('/api/ai/generate/stream', '/api/ai/generate')
    and not coalesce((l.request_params->>'is_admin')::boolean, false)
),
engine as (
  select cur, jsonb_build_object(
    'requests', count(*),
    'errors', count(*) filter (where response_status >= 400),
    'cache_hits', count(*) filter (where cache_hit),
    'p50_ms', percentile_cont(0.5) within group (order by response_time_ms)
                filter (where response_status = 200 and not cache_hit),
    'p90_ms', percentile_cont(0.9) within group (order by response_time_ms)
                filter (where response_status = 200 and not cache_hit),
    'first_day_p50_ms', percentile_cont(0.5) within group (order by first_day_ms)
                filter (where first_day_ms is not null)) as j
  from gen
  group by cur
),
spend as (
  select cur, jsonb_object_agg(kind, usd) as j
  from (
    select l.timestamp >= b.cur_start as cur,
           case when l.api_name = 'gemini' then 'gemini'
                when l.api_name like 'google_places%' then 'google_places'
                else 'other' end as kind,
           round(sum(l.cost_usd)::numeric, 2) as usd
    from api_request_logs l, bounds b
    where l.timestamp >= b.prev_start and l.cost_usd > 0
    group by 1, 2
  ) s
  group by cur
),
live_windows as (
  select true as cur, current_date - (p_days - 1) as lo, current_date + 1 as hi
  union all
  select false, current_date - (2 * p_days - 1), current_date - (p_days - 1)
),
live_trips as (
  select w.cur, t.user_id is not null as owned,
    exists (select 1 from trip_views v
            where v.trip_id = t.id and v.viewer_id = t.user_id and v.is_bot = false
              and v.viewed_on between greatest(t.start_date, w.lo) and least(t.end_date, w.hi - 1)
              and not exists (select 1 from page_view_session_labels s
                              where s.session_id = v.session_id and s.day = v.viewed_on and s.is_automation)) as owner_back,
    exists (select 1 from trip_today_actions a
            where a.trip_id = t.id and a.undone_at is null
              and a.created_at >= greatest(t.start_date, w.lo) and a.created_at < least(t.end_date + 1, w.hi)) as used_today,
    exists (select 1 from trip_participants p
            where p.trip_id = t.id and p.joined_at < least(t.end_date + 1, w.hi)
              and (p.left_at is null or p.left_at >= greatest(t.start_date, w.lo))) as with_participants
  from live_windows w
  join trips t on t.deleted_at is null and coalesce(t.is_template, false) = false
    and t.start_date < w.hi and t.end_date >= w.lo
),
live as (
  select cur, jsonb_build_object(
    'trips', count(*),
    'owned', count(*) filter (where owned),
    'owner_back', count(*) filter (where owner_back),
    'used_today', count(*) filter (where used_today),
    'with_participants', count(*) filter (where with_participants)) as j
  from live_trips
  group by cur
),
days as (
  select generate_series((now() - make_interval(days => 2 * p_days - 1))::date, now()::date, interval '1 day')::date as day
),
daily as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', d.day,
    'plans', (select count(distinct s.session_id) from steps s
              where s.step = 'result' and s.created_at::date = d.day),
    'usd', (select coalesce(round(sum(l.cost_usd)::numeric, 2), 0) from api_request_logs l
            where l.timestamp >= d.day and l.timestamp < d.day + 1 and l.cost_usd > 0)
  ) order by d.day), '[]'::jsonb) as j
  from days d
)
select jsonb_build_object(
  'days', p_days,
  'generated_at', now(),
  'funnel', jsonb_build_object(
    'cur', coalesce((select j from funnel where cur), '{}'::jsonb) || coalesce((select j from kept where cur), '{}'::jsonb),
    'prev', coalesce((select j from funnel where not cur), '{}'::jsonb) || coalesce((select j from kept where not cur), '{}'::jsonb)),
  'engine', jsonb_build_object(
    'cur', coalesce((select j from engine where cur), '{}'::jsonb),
    'prev', coalesce((select j from engine where not cur), '{}'::jsonb)),
  'spend', jsonb_build_object(
    'cur', coalesce((select j from spend where cur), '{}'::jsonb),
    'prev', coalesce((select j from spend where not cur), '{}'::jsonb)),
  'live', jsonb_build_object(
    'cur', coalesce((select j from live where cur), '{}'::jsonb),
    'prev', coalesce((select j from live where not cur), '{}'::jsonb)),
  'daily', (select j from daily)
);
$$;

revoke execute on function public.mission_control(integer) from public, anon, authenticated;
grant execute on function public.mission_control(integer) to service_role;
