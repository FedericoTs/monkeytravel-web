-- get_live_trip_baseline(): the automation-share guardrail reads the label
-- table instead of re-scanning raw page_views.
--
-- raw is_bot=false views  =  human views  +  views in labelled session-days
-- page_view_session_labels stores `views` per (session, day), so the second
-- term is a sum over ~10k small rows, not a second 155k-row heap scan. Exact
-- same number, one scan fewer. With 20260905160000's covering index the one
-- remaining scan is index-only. Everything else in the function is unchanged
-- from 20260905153000; the whole body is restated because plpgsql functions
-- cannot be patched in place.

create or replace function public.get_live_trip_baseline(p_days integer default 28)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  hi  timestamptz := date_trunc('day', now());
  lo  timestamptz := date_trunc('day', now()) - make_interval(days => greatest(p_days, 7));
  d   numeric     := greatest(p_days, 7);
  today date      := (now() at time zone 'utc')::date;
  v_wizard jsonb; v_recipients jsonb; v_sharing jsonb; v_retention jsonb; v_live jsonb; v_guard jsonb;
  v_recipient_sessions bigint;
  v_human_views bigint;
  v_labelled_views bigint;
begin
  drop table if exists bl_pv;
  create temp table bl_pv on commit drop as
    select session_id, user_id, path, created_at
    from public.page_views_human
    where created_at >= lo and created_at < hi;
  create index on bl_pv (session_id, created_at);
  create index on bl_pv (user_id, created_at);
  analyze bl_pv;
  select count(*) into v_human_views from bl_pv;
  select coalesce(sum(views), 0) into v_labelled_views
  from public.page_view_session_labels
  where is_automation and day >= lo::date and day < hi::date;

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

  with rs as (
    select session_id, min(created_at) as first_view
    from bl_pv
    where path ~ '^(/(es|it|pt))?/(shared|trip)/'
    group by session_id
  ),
  onward as (
    select r.session_id,
           bool_or(p.path ~ '/trips/new') as to_wizard,
           bool_or(p.path ~ '/auth/')     as to_auth
    from rs r
    join bl_pv p on p.session_id = r.session_id and p.created_at >= r.first_view
    group by r.session_id
  )
  select count(*),
         jsonb_build_object(
           'recipient_sessions',          count(*),
           'recipient_sessions_per_week', round(count(*) * 7.0 / d, 1),
           'recipient_to_wizard_pct',     round(100.0 * count(*) filter (where to_wizard) / nullif(count(*), 0), 1),
           'recipient_to_auth_pct',       round(100.0 * count(*) filter (where to_auth)   / nullif(count(*), 0), 1)
         )
  into v_recipient_sessions, v_recipients
  from onward;

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
    'recipients_per_share',     round(v_recipient_sessions::numeric / nullif(sh.shared, 0), 1),
    'new_users',                u.new_users,
    'signups_via_invite',       u.via_invite,
    'signups_referred',         u.referred,
    'k_factor',                 round((u.via_invite + u.referred)::numeric / nullif(u.new_users, 0), 3),
    'participants_per_shared_trip', null,
    'recipient_to_participant_pct', null
  ) into v_sharing from t, sh, u;

  with cohort as (
    select count(*) as n, count(*) filter (where login_count > 1) as returned
    from public.users where created_at >= lo and created_at < hi
  ),
  ended as (
    select t.id, t.user_id, t.end_date
    from public.trips t
    where t.deleted_at is null and coalesce(t.is_template, false) = false
      and t.end_date + 7 >= lo::date and t.end_date + 7 < hi::date
  ),
  post as (
    select e.id,
           exists (select 1 from bl_pv p
                   where p.user_id = e.user_id
                     and p.created_at >  e.end_date::timestamptz
                     and p.created_at <= (e.end_date + 7)::timestamptz) as came_back
    from ended e
  )
  select jsonb_build_object(
    'cohort_users',            c.n,
    'return_once_pct',         round(100.0 * c.returned / nullif(c.n, 0), 1),
    'trips_ended',             (select count(*) from post),
    'post_trip_return_7d_pct', (select round(100.0 * count(*) filter (where came_back) / nullif(count(*), 0), 1) from post)
  ) into v_retention from cohort c;

  with travelled as (
    select id, user_id, start_date, end_date, updated_at
    from public.trips
    where deleted_at is null and coalesce(is_template, false) = false
      and start_date is not null and end_date is not null
      and end_date < hi::date and start_date >= date '2026-05-01'
  ),
  opened as (
    select c.id,
           exists (select 1 from public.trip_views v
                   where v.trip_id = c.id and v.is_bot = false
                     and v.viewed_on between c.start_date and c.end_date) as opened_during
    from travelled c where c.end_date >= lo::date
  ),
  in_progress as (
    select t.id,
           exists (select 1 from public.trip_views v
                   where v.trip_id = t.id and v.is_bot = false and v.viewed_on = today) as opened_today
    from public.trips t
    where t.deleted_at is null and coalesce(t.is_template, false) = false
      and t.start_date <= today and t.end_date >= today
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

  select jsonb_build_object(
    'saves_per_day',        round((select count(*) from public.wizard_step_events where step = 'saved' and created_at >= lo and created_at < hi) / d, 1),
    'human_views_per_day',  round(v_human_views / d, 0),
    'automation_share_pct', round(100.0 * v_labelled_views / nullif(v_human_views + v_labelled_views, 0), 1)
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

revoke execute on function public.get_live_trip_baseline(integer) from public, anon, authenticated;
grant execute on function public.get_live_trip_baseline(integer) to service_role;
