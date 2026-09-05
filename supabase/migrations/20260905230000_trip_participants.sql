-- Live Trip plan, Phase 2.1 — "I'm going".
--
-- A recipient of a shared or public trip can say they are going. That turns
-- the highest-intent people in the funnel (human recipient sessions, ~3,000
-- per 28 days) from readers into participants: the group the trip belongs
-- to, and the audience for Today mode (Phase 3) and trip-time notifications
-- (Phase 4).
--
-- One row per (trip, participant cookie). The cookie is the SAME opaque id
-- the anonymous vote route mints (mt_anon_voter, anonymous_activity_votes.
-- voter_cookie_id), so a participant's later votes are attributed to them
-- without a second identity. user_id is filled when the recipient happens to
-- be signed in. display_name and email are optional and given by the
-- participant themselves; email is captured for this trip's notifications
-- only (purpose stated in the field).
--
-- ACCESS: RLS on, NO policies. Nobody reads or writes this table through
-- PostgREST with the anon or authenticated key — not even the trip owner.
-- Every read and write goes through the service role behind explicit
-- checks: POST /api/shared/[token]/join (possession of the share token),
-- GET /api/shared/[token]/participants (count + names for the page),
-- GET/DELETE /api/trips/[id]/participants (owner only). The email column is
-- the reason: the owner sees names and join times, never addresses.
-- Additive; the table is new.

create table if not exists public.trip_participants (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.trips(id) on delete cascade,
  participant_cookie_id text not null,
  user_id               uuid null references auth.users(id) on delete set null,
  display_name          text null,
  email                 text null,
  joined_at             timestamptz not null default now(),
  source                text not null,
  left_at               timestamptz null,
  constraint trip_participants_source_check check (source in ('shared', 'public', 'crew_ask')),
  constraint trip_participants_cookie_len check (char_length(participant_cookie_id) between 10 and 60),
  constraint trip_participants_name_len check (display_name is null or char_length(display_name) between 1 and 60),
  constraint trip_participants_email_len check (email is null or char_length(email) between 3 and 254),
  constraint trip_participants_trip_cookie_key unique (trip_id, participant_cookie_id)
);

-- "Who's going" and the header count: active participants of one trip.
create index if not exists idx_trip_participants_trip_active
  on public.trip_participants (trip_id, joined_at)
  where left_at is null;

-- Weekly metric: taps in a window.
create index if not exists idx_trip_participants_joined_at
  on public.trip_participants (joined_at);

alter table public.trip_participants enable row level security;
-- Deliberately no policies. See the header. `npm run rls:check` pins this.

comment on table public.trip_participants is
  'One row per (trip, participant cookie) "I''m going" tap. Source of the recipient → participant rate and participants per shared trip. Service role only; see supabase/migrations/20260905230000_trip_participants.sql.';
comment on column public.trip_participants.participant_cookie_id is 'Same opaque id as anonymous_activity_votes.voter_cookie_id (cookie mt_anon_voter), so votes and participation share one identity.';
comment on column public.trip_participants.email is 'Given by the participant for this trip''s notifications only. Never exposed to the owner; only its presence is.';
comment on column public.trip_participants.left_at is 'Set when the participant taps "Not going" or the owner removes them. Rows are kept for the tap-rate history.';

-- ---------------------------------------------------------------------------
-- Weekly measurement (Phase 2 exit gate: tap rate reported weekly from
-- page_views_human + trip_participants). Separate from get_live_trip_baseline
-- so the frozen baseline function stays what it was; scripts/baseline-snapshot
-- prints both.
--
-- recipient_to_participant_pct = distinct participant cookies that tapped in
-- the window ÷ human recipient sessions in the window. The two identities
-- differ (a cookie can span sessions), so this is a rate of people over
-- sessions — stated as such in the snapshot, the same way K is stated.
-- participant → own trip is NOT linkable yet (the voter cookie never reaches
-- page_views); `with_account` is the honest proxy until it is.
create or replace function public.get_live_trip_participant_metrics(p_days integer default 28)
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
  v_recipient_sessions bigint;
  v_shared bigint;
  v_out jsonb;
begin
  select count(distinct session_id) into v_recipient_sessions
  from public.page_views_human
  where created_at >= lo and created_at < hi
    and path ~ '^(/(es|it|pt))?/(shared|trip)/';

  select count(*) into v_shared
  from public.trips where shared_at >= lo and shared_at < hi;

  select jsonb_build_object(
    'window', jsonb_build_object('from', lo::date, 'to_exclusive', hi::date, 'days', d, 'computed_at', now()),
    'taps_in_window',              count(*) filter (where joined_at >= lo and joined_at < hi),
    'tappers_in_window',           count(distinct participant_cookie_id) filter (where joined_at >= lo and joined_at < hi),
    'participants_active',         count(*) filter (where left_at is null),
    'trips_with_participants',     count(distinct trip_id) filter (where left_at is null),
    'recipient_sessions',          v_recipient_sessions,
    'recipient_to_participant_pct', round(100.0 * count(distinct participant_cookie_id) filter (where joined_at >= lo and joined_at < hi)
                                          / nullif(v_recipient_sessions, 0), 2),
    'trips_shared_in_window',      v_shared,
    'participants_per_shared_trip', round((count(*) filter (where joined_at >= lo and joined_at < hi))::numeric / nullif(v_shared, 0), 2),
    'name_capture_pct',            round(100.0 * count(*) filter (where left_at is null and display_name is not null) / nullif(count(*) filter (where left_at is null), 0), 1),
    'email_capture_pct',           round(100.0 * count(*) filter (where left_at is null and email is not null)        / nullif(count(*) filter (where left_at is null), 0), 1),
    'with_account',                count(*) filter (where left_at is null and user_id is not null),
    'measured_since',              (select min(joined_at)::date from public.trip_participants)
  ) into v_out
  from public.trip_participants;

  return v_out;
end;
$$;

revoke execute on function public.get_live_trip_participant_metrics(integer) from public, anon, authenticated;
grant execute on function public.get_live_trip_participant_metrics(integer) to service_role;

comment on function public.get_live_trip_participant_metrics(integer) is
  'Phase 2 weekly metrics: taps, tap rate over human recipient sessions, participants per shared trip, name/email capture. service_role only; printed by scripts/baseline-snapshot.mts.';
