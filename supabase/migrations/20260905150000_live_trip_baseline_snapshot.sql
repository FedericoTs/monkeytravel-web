-- Phase 0.4 of docs/LIVE_TRIP_MASTER_PLAN.md — a reproducible baseline.
--
-- The plan freezes a set of numbers so every later phase is judged against
-- the same yardstick. Hand-typed numbers drift: they are copied from ad-hoc
-- queries whose windows, filters and definitions nobody can reproduce a month
-- later. This function IS the definition. scripts/baseline-snapshot.mts calls
-- it and prints the block that goes into the plan; the weekly ritual in
-- Phase 7 calls the same function, so "then" and "now" mean the same thing.
--
-- Every figure reads labelled data: page_views_human (self-declared crawlers
-- AND automation labels excluded, Phase 0.2) and wizard sessions with the same
-- label filter applied. Raw page_views appears only in the automation-share
-- guardrail, where it is the denominator.
--
-- Definitions shared with the previous plan's get_ux10x_rates, so the two
-- baselines agree on common terms:
--   step1->2   sessions with both step_1_destination_dates and step_2_vibes,
--              over wizard-arm sessions (front_door null or 'wizard')
--   saves      wizard_step_events.step = 'saved'
--   trips      coalesce(is_template,false) = false and deleted_at is null
--
-- Window: the last p_days FULL UTC days ending at today 00:00, so a snapshot
-- taken at 09:00 and one at 21:00 agree.
--
-- Read-only. SECURITY DEFINER so it can be scheduled later as the owner;
-- EXECUTE revoked from PUBLIC/anon/authenticated in this same migration
-- because it aggregates every visitor's behaviour — service role only, the
-- same grant shape as get_ux10x_rates was documented to have.

create or replace function public.get_live_trip_baseline(p_days integer default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hi  timestamptz := date_trunc('day', now());
  lo  timestamptz := date_trunc('day', now()) - make_interval(days => greatest(p_days, 7));
  d   numeric     := greatest(p_days, 7);
  v_wizard jsonb; v_recipients jsonb; v_sharing jsonb; v_retention jsonb; v_live jsonb; v_guard jsonb;
begin
  ---------------------------------------------------------------- wizard (human sessions)
  with w as (
    select e.session_id,
           bool_or(e.step = 'step_1_destination_dates') as s1,
           bool_or(e.step = 'step_2_vibes')             as s2,
           bool_or(e.step = 'result')                   as res,
           bool_or(e.step = 'saved')                    as sv
    from public.wizard_step_events e
    where (e.front_door is null or e.front_door = 'wizard')
      and e.created_at >= lo and e.created_at < hi
      and e.session_id is not null
      and not exists (select 1 from public.page_view_session_labels l
                      where l.session_id = e.session_id and l.day = e.created_at::date and l.is_automation)
    group by e.session_id
  )
  select jsonb_build_object(
    'step1_sessions',      count(*) filter (where s1),
    'step2_sessions',      count(*) filter (where s1 and s2),
    'result_sessions',     count(*) filter (where s1 and res),
    'saved_sessions',      count(*) filter (where s1 and sv),
    'step1_to_2_pct',      round(100.0 * count(*) filter (where s1 and s2)  / nullif(count(*) filter (where s1), 0), 1),
    'step1_to_result_pct', round(100.0 * count(*) filter (where s1 and res) / nullif(count(*) filter (where s1), 0), 1),
    'result_to_saved_pct', round(100.0 * count(*) filter (where s1 and sv)  / nullif(count(*) filter (where s1 and res), 0), 1)
  ) into v_wizard from w;

  ---------------------------------------------------------------- recipients (human view)
  with rs as (
    select session_id, min(created_at) as first_view
    from public.page_views_human
    where created_at >= lo and created_at < hi
      and path ~ '^(/(es|it|pt))?/(shared|trip)/'
    group by session_id
  ),
  onward as (
    select r.session_id,
           bool_or(p.path ~ '/trips/new')          as to_wizard,
           bool_or(p.path ~ '/auth/')              as to_auth
    from rs r
    join public.page_views_human p on p.session_id = r.session_id and p.created_at >= r.first_view and p.created_at < hi
    group by r.session_id
  )
  select jsonb_build_object(
    'recipient_sessions',       (select count(*) from rs),
    'recipient_sessions_per_week', round((select count(*) from rs) * 7.0 / d, 1),
    'recipient_to_wizard_pct',  round(100.0 * count(*) filter (where to_wizard) / nullif(count(*), 0), 1),
    'recipient_to_auth_pct',    round(100.0 * count(*) filter (where to_auth)   / nullif(count(*), 0), 1)
  ) into v_recipients from onward;

  ---------------------------------------------------------------- sharing and K
  with t as (
    select count(*) as created,
           count(*) filter (where shared_at is not null) as shared_of_created
    from public.trips
    where created_at >= lo and created_at < hi
      and coalesce(is_template, false) = false and deleted_at is null
  ),
  sh as (select count(*) as shared from public.trips where shared_at >= lo and shared_at < hi),
  u as (
    select count(*) as new_users,
           count(*) filter (where signed_up_via_trip_invite is not null) as via_invite,
           count(*) filter (where referred_by_code is not null)          as referred
    from public.users where created_at >= lo and created_at < hi
  )
  select jsonb_build_object(
    'trips_created',            t.created,
    'trips_created_per_day',    round(t.created / d, 1),
    'trips_shared',             sh.shared,
    'share_rate_pct',           round(100.0 * t.shared_of_created / nullif(t.created, 0), 1),
    'recipients_per_share',     round((v_recipients->>'recipient_sessions')::numeric / nullif(sh.shared, 0), 1),
    'new_users',                u.new_users,
    'signups_via_invite',       u.via_invite,
    'signups_referred',         u.referred,
    'k_factor',                 round((u.via_invite + u.referred)::numeric / nullif(u.new_users, 0), 3),
    'participants_per_shared_trip', null,
    'recipient_to_participant_pct', null
  ) into v_sharing from t, sh, u;

  ---------------------------------------------------------------- retention
  with cohort as (
    select count(*) as n, count(*) filter (where login_count > 1) as returned
    from public.users where created_at >= lo and created_at < hi
  ),
  ended as (
    -- trips whose 7-day post-trip window closed inside [lo, hi)
    select t.id, t.user_id, t.end_date
    from public.trips t
    where t.deleted_at is null and coalesce(t.is_template, false) = false
      and t.end_date + 7 >= lo::date and t.end_date + 7 < hi::date
  ),
  post as (
    select e.id,
           exists (select 1 from public.page_views_human p
                   where p.user_id = e.user_id
                     and p.created_at >  e.end_date::timestamptz
                     and p.created_at <= (e.end_date + 7)::timestamptz) as came_back
    from ended e
  )
  select jsonb_build_object(
    'cohort_users',           c.n,
    'return_once_pct',        round(100.0 * c.returned / nullif(c.n, 0), 1),
    'trips_ended',            (select count(*) from post),
    'post_trip_return_7d_pct', (select round(100.0 * count(*) filter (where came_back) / nullif(count(*), 0), 1) from post)
  ) into v_retention from cohort c;

  ---------------------------------------------------------------- the live trip
  with travelled as (
    select id, user_id, start_date, end_date, updated_at
    from public.trips
    where deleted_at is null and coalesce(is_template, false) = false
      and start_date is not null and end_date is not null
      and end_date < hi::date and start_date >= date '2026-05-01'
  ),
  completed_in_window as (
    select * from travelled where end_date >= lo::date
  ),
  opened as (
    select c.id,
           exists (select 1 from public.trip_views v
                   where v.trip_id = c.id and v.is_bot = false
                     and v.viewed_on between c.start_date and c.end_date) as opened_during
    from completed_in_window c
  ),
  in_progress as (
    select t.id,
           exists (select 1 from public.trip_views v
                   where v.trip_id = t.id and v.is_bot = false and v.viewed_on = (now() at time zone 'utc')::date) as opened_today
    from public.trips t
    where t.deleted_at is null and coalesce(t.is_template, false) = false
      and t.start_date <= (now() at time zone 'utc')::date and t.end_date >= (now() at time zone 'utc')::date
  )
  select jsonb_build_object(
    'travelled_since_may',        (select count(*) from travelled),
    'edited_during_trip_pct',     (select round(100.0 * count(*) filter (where updated_at::date between start_date and end_date) / nullif(count(*), 0), 1) from travelled),
    'trips_completed_in_window',  (select count(*) from opened),
    'todt_pct',                   (select round(100.0 * count(*) filter (where opened_during) / nullif(count(*), 0), 1) from opened),
    'todt_measured_since',        (select min(viewed_at)::date from public.trip_views),
    'trips_in_progress_today',    (select count(*) from in_progress),
    'in_progress_opened_today',   (select count(*) filter (where opened_today) from in_progress),
    'trip_views_in_window',       (select jsonb_object_agg(source, n) from (select source, count(*) as n from public.trip_views where is_bot = false and viewed_at >= lo and viewed_at < hi group by source) s)
  ) into v_live;

  ---------------------------------------------------------------- guardrails
  select jsonb_build_object(
    'saves_per_day',        round((select count(*) from public.wizard_step_events where step = 'saved' and created_at >= lo and created_at < hi) / d, 1),
    'human_views_per_day',  round((select count(*) from public.page_views_human where created_at >= lo and created_at < hi) / d, 0),
    'automation_share_pct', (select round(100.0 * (1 - h.n::numeric / nullif(r.n, 0)), 1)
                             from (select count(*) as n from public.page_views_human where created_at >= lo and created_at < hi) h,
                                  (select count(*) as n from public.page_views where is_bot = false and created_at >= lo and created_at < hi) r)
  ) into v_guard;

  return jsonb_build_object(
    'window',     jsonb_build_object('from', lo::date, 'to_exclusive', hi::date, 'days', d, 'computed_at', now()),
    'wizard',     v_wizard,
    'recipients', v_recipients,
    'sharing',    v_sharing,
    'retention',  v_retention,
    'live_trip',  v_live,
    'guardrails', v_guard
  );
end
$$;

comment on function public.get_live_trip_baseline(integer) is
  'Reproducible baseline for docs/LIVE_TRIP_MASTER_PLAN.md: wizard funnel, recipients, sharing/K, retention, live-trip (TODT) and guardrails over the last p_days full UTC days, all from labelled human data. Read by scripts/baseline-snapshot.mts. Service role only.';

-- Aggregates every visitor's behaviour: nobody but the service role reads it.
revoke execute on function public.get_live_trip_baseline(integer) from public, anon, authenticated;
grant execute on function public.get_live_trip_baseline(integer) to service_role;
