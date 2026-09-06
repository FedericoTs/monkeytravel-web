-- Live Trip plan, Phase 3.3 — the four in-trip chips.
--
-- On a live trip's Today view, the owner and every participant can act:
--   running_late · skip · swap · done. Each writes a row here; everyone's
-- Today view reads them (real-time, like activity_votes) and OVERLAYS them on
-- the itinerary — it never mutates the owner's itinerary JSON, because a
-- shared-trip participant is anonymous and cannot (RLS: trips_update needs
-- user_id = auth.uid()). This is the chips' shared substrate, the same shape
-- as anonymous_activity_votes: public SELECT (so anon real-time works),
-- writes only through the service role behind the /shared/[token] routes.
--
-- Identity is the SAME mt_anon_voter cookie used by votes and participants, so
-- a participant's chips, votes and "I'm going" are one person. The actor's
-- name is copied from trip_participants at write time for the feed.
--
-- No email or other PII here — only an action, an activity reference, and a
-- display name someone chose to share — so a public read is consistent with
-- the votes table (voter_display_name is already world-readable).

create table if not exists public.trip_today_actions (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  day_number      integer not null,
  action_type     text not null,
  -- The affected activity for skip/swap; null for the day-level running_late/done.
  activity_id     text null,
  payload         jsonb not null default '{}'::jsonb,
  actor_cookie_id text null,
  actor_user_id   uuid null references auth.users(id) on delete set null,
  actor_name      text null,
  actor_role      text not null,
  created_at      timestamptz not null default now(),
  undone_at       timestamptz null,
  constraint trip_today_actions_type_check check (action_type in ('running_late', 'skip', 'swap', 'done')),
  constraint trip_today_actions_role_check check (actor_role in ('owner', 'participant')),
  constraint trip_today_actions_day_check check (day_number >= 1),
  constraint trip_today_actions_name_len check (actor_name is null or char_length(actor_name) <= 60)
);

-- Today's active overlay for one trip: the hot read path + the realtime filter.
create index if not exists idx_trip_today_actions_active
  on public.trip_today_actions (trip_id, day_number)
  where undone_at is null;

-- Idempotency for a chip tap: at most ONE active action per
-- (actor, type, activity, day). A double-tap is a no-op (ON CONFLICT DO
-- NOTHING in the route); undo is a separate, explicit control that sets
-- undone_at. The coalesces make the key stable when a column is null.
create unique index if not exists uniq_trip_today_actions_active
  on public.trip_today_actions (
    trip_id,
    day_number,
    action_type,
    coalesce(activity_id, ''),
    coalesce(actor_cookie_id, actor_user_id::text, '')
  )
  where undone_at is null;

alter table public.trip_today_actions enable row level security;

-- Public read (like anonymous_activity_votes) so anonymous participants'
-- browsers receive realtime and can hydrate the overlay. No write policies:
-- every insert/undo goes through the service role in the /shared routes.
drop policy if exists "Anyone can read today actions" on public.trip_today_actions;
create policy "Anyone can read today actions"
  on public.trip_today_actions
  for select
  using (true);

-- Realtime: deliver inserts, undo-updates and deletes to every open Today
-- view. REPLICA IDENTITY FULL so an undo (UPDATE) carries enough of the row
-- for clients to reconcile.
alter table public.trip_today_actions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_today_actions'
  ) then
    alter publication supabase_realtime add table public.trip_today_actions;
  end if;
end $$;

comment on table public.trip_today_actions is
  'Live Trip Phase 3.3: in-trip chip actions (running_late/skip/swap/done) overlaid on Today. Public SELECT + realtime; writes are service-role only via /api/shared/[token]/today-action. Never mutates trips.itinerary.';
comment on column public.trip_today_actions.actor_cookie_id is 'Same mt_anon_voter cookie as votes/participants — one identity per person.';
comment on column public.trip_today_actions.undone_at is 'Set by the one-tap undo; the row is kept for the activity feed history.';
