-- TODT counts a trip only when its own people open it during the trip: the
-- owner, a collaborator or a participant. Opens by anyone else are reported
-- beside it, and sessions labelled automation count for neither. trip_views
-- gains participant_id so an anonymous participant's open can count, and the
-- baseline takes an optional end date so a past window can be recomputed.

alter table public.trip_views
  add column if not exists participant_id uuid
    references public.trip_participants(id) on delete set null;

comment on column public.trip_views.participant_id is
  'The trip_participants row whose cookie made this open, when the viewer had joined the trip. Counts toward TODT.';

drop function if exists public.get_live_trip_baseline(integer);

create function public.get_live_trip_baseline(p_days integer default 28, p_to date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  hi  timestamptz := coalesce(p_to::timestamptz, date_trunc('day', now()));
  lo  timestamptz := hi - make_interval(days => greatest(p_days, 7));
  d   numeric     := greatest(p_days, 7);
  -- a past window reads "today" as its last day
  today date      := coalesce(p_to - 1, (now() at time zone 'utc')::date);
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
    -- reads the VIEW, not the temp table: the 7-day window can start before lo
    select e.id,
           exists (select 1 from public.page_views_human p
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
  -- Human opens only: no self-declared bot, no session labelled automation
  -- that day. by_traveller: the owner, a collaborator or a participant.
  opens as (
    select v.trip_id, v.viewed_on,
           v.participant_id is not null
           or (v.viewer_id is not null and (
                 v.viewer_id = t.user_id
              or exists (select 1 from public.trip_collaborators tc
                         where tc.trip_id = v.trip_id and tc.user_id = v.viewer_id)
              or exists (select 1 from public.trip_participants tp
                         where tp.trip_id = v.trip_id and tp.user_id = v.viewer_id
                           and (tp.left_at is null or tp.left_at::date > v.viewed_on)))) as by_traveller
    from public.trip_views v
    join public.trips t on t.id = v.trip_id
    where v.is_bot = false
      and not exists (select 1 from public.page_view_session_labels l
                      where l.session_id = v.session_id and l.day = v.viewed_on and l.is_automation)
  ),
  opened as (
    select c.id,
           exists (select 1 from opens o
                   where o.trip_id = c.id and o.by_traveller
                     and o.viewed_on between c.start_date and c.end_date) as by_travellers,
           exists (select 1 from opens o
                   where o.trip_id = c.id
                     and o.viewed_on between c.start_date and c.end_date) as by_anyone
    from travelled c where c.end_date >= lo::date
  ),
  in_progress as (
    select t.id,
           exists (select 1 from opens o
                   where o.trip_id = t.id and o.by_traveller and o.viewed_on = today) as opened_today
    from public.trips t
    where t.deleted_at is null and coalesce(t.is_template, false) = false
      and t.start_date <= today and t.end_date >= today
  )
  select jsonb_build_object(
    'travelled_since_may',        (select count(*) from travelled),
    'edited_during_trip_pct',     (select round(100.0 * count(*) filter (where updated_at::date between start_date and end_date) / nullif(count(*), 0), 1) from travelled),
    'trips_completed_in_window',  (select count(*) from opened),
    'todt_pct',                   (select round(100.0 * count(*) filter (where by_travellers) / nullif(count(*), 0), 1) from opened),
    'todt_any_viewer_pct',        (select round(100.0 * count(*) filter (where by_anyone) / nullif(count(*), 0), 1) from opened),
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

revoke execute on function public.get_live_trip_baseline(integer, date) from public, anon, authenticated;
grant execute on function public.get_live_trip_baseline(integer, date) to service_role;
