-- trip_views: Phase 0.1 of docs/LIVE_TRIP_MASTER_PLAN.md.
--
-- The table had never received a row. The writer (app/api/trips/[id]/view)
-- existed; nothing called it. It becomes the source for the North Star,
-- "Trips Opened During Travel" — a trip counts when at least one human opens
-- it on at least one calendar day inside [start_date, end_date].
--
-- 1. DEDUPE PER DAY, NOT FOREVER.
--    UNIQUE (trip_id, session_id) collapsed a persistent mt_session_id cookie
--    to one row per trip for life, so a Day-3 open after a Day-1 open was
--    invisible — exactly the signal TODT needs. The key becomes
--    (trip_id, session_id, viewed_on).
--
-- 2. CONSTRAIN source to what the renderers send.
--    shared       /shared/[token]        anonymous recipient
--    public       /trip/[slug]           indexable public page
--    owner        /trips/[id]            the owner
--    collaborator /trips/[id]            a collaborator (the page is not
--                                        owner-only, whatever its comment says)
--
-- 3. CARRY is_bot from the user-agent (lib/analytics/bot-detection), so TODT
--    can exclude self-declared crawlers on the indexable surface. Labelling
--    only: no request is refused anywhere (standing rule, 2026-09-03).
--
-- viewed_on is the UTC day. Phase 3 introduces a per-trip timezone; a ±1 day
-- edge on a rate whose baseline is "unknown" is acceptable until then.
--
-- Additive and idempotent; the table is empty at the time of writing.

alter table public.trip_views
  add column if not exists viewed_on date not null default ((now() at time zone 'utc')::date),
  add column if not exists is_bot boolean not null default false;

-- Drop the lifetime unique (its backing index goes with it) and replace it
-- with the per-day key.
alter table public.trip_views
  drop constraint if exists trip_views_trip_id_session_id_key;

create unique index if not exists trip_views_trip_session_day_key
  on public.trip_views (trip_id, session_id, viewed_on);

alter table public.trip_views
  drop constraint if exists trip_views_source_check;

alter table public.trip_views
  add constraint trip_views_source_check
  check (source in ('shared', 'public', 'owner', 'collaborator'));

-- The TODT query shape: human opens per trip per day.
create index if not exists idx_trip_views_trip_day_human
  on public.trip_views (trip_id, viewed_on)
  where is_bot = false;

comment on table public.trip_views is
  'One row per (trip, session, UTC day) open. Source of the TODT north star. Written by POST /api/trips/[id]/view from SharedTripView (shared/public) and TripDetailClient (owner/collaborator). session_id is the mt_session_id cookie, or a daily sha256 of ip|ua when the cookie is absent. is_bot is UA-derived; label, never block.';
comment on column public.trip_views.viewed_on is 'UTC calendar day of the open; part of the dedupe key.';
comment on column public.trip_views.is_bot is 'Self-declared crawler per lib/analytics/bot-detection. Exclude from TODT.';
