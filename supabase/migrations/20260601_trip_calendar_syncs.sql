-- 20260601 — trip_calendar_syncs: per-(trip, provider) Google Calendar
-- sync record + per-user OAuth token storage.
--
-- Background
-- ----------
-- Phase 2 of the calendar-export feature (see
-- docs/specs/calendar-export-smart-notifs.md) lets a user click
-- "Add to Google Calendar" → OAuth dance → server POSTs trip events
-- straight into the user's primary calendar via Google Calendar API.
--
-- We need two persistence surfaces:
--
--   1. user_calendar_connections — long-lived per-user Google OAuth
--      tokens. refresh_token is the high-value secret; we encrypt it
--      at the application layer with AES-256-GCM keyed by a
--      Vercel-env secret (CALENDAR_TOKEN_ENC_KEY) before insert. The
--      column is bytea — pgsodium is NOT installed on this project
--      (verified via list_extensions), so app-layer encryption is the
--      pragmatic choice. The encryption format is documented in
--      lib/calendar/token-encryption.ts.
--
--   2. trip_calendar_syncs — one row per (trip, provider) we have
--      synced. Used for two things:
--        (a) detecting "this trip is already wired up" UI state
--            (toast on success, future re-sync flows), and
--        (b) a future patch-or-insert reconciliation cycle in
--            Phase 2.5 (matching by trip+provider before deciding
--            whether to POST new events or PATCH existing ones via
--            extendedProperties.private.monkeytravel_trip_id).
--
-- We deliberately do NOT mirror per-event ids (trip_calendar_events
-- in the PRD) in this Phase 2 cut — Phase 2 is one-shot insert via
-- extendedProperties. Per-event reconciliation lands in Phase 2.5
-- when we add the "trip was edited → re-sync" path.
--
-- RLS
-- ---
-- Trip owners + collaborators can SELECT their syncs (CAUSALITY:
-- the success toast on TripDetailClient reads via the server; an RLS
-- SELECT path keeps client-side polling cheap if we wire it later).
-- Writes are service-role only — the OAuth callback uses the admin
-- client (it needs to bypass RLS to write encrypted tokens anyway).
--
-- CAUSALITY (consumers)
-- ---------------------
-- - lib/calendar/token-encryption.ts   — encrypt/decrypt at app layer
-- - lib/calendar/google-oauth.ts       — OAuth URL build + state HMAC
-- - lib/calendar/google-sync.ts        — sync trip → Google events
-- - app/api/calendar/google/connect/route.ts   — kicks off OAuth
-- - app/api/calendar/google/callback/route.ts  — exchanges code + syncs
-- - app/[locale]/trips/[id]/TripDetailClient.tsx  — toast on ?gcal_sync=done

-- ---------------------------------------------------------------------------
-- 1. user_calendar_connections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_calendar_connections (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google')),
  -- Short-lived access token. Useful only for the lifetime of the
  -- OAuth callback (we sync immediately). We DO store it for the
  -- (rare) case where we want to issue a follow-up sync within the
  -- 1h expiry without a refresh round-trip. Encrypted same as
  -- refresh_token (see token-encryption.ts).
  access_token_enc BYTEA NOT NULL,
  -- Long-lived. The crown jewel — leaking this == ongoing calendar
  -- access for the user. Encrypted with AES-256-GCM at the app
  -- layer. pgsodium would be cleaner but is not installed on Trawell.
  -- KNOWN-RISK / FUTURE-WORK: migrate to pgsodium when/if it's enabled.
  refresh_token_enc BYTEA NOT NULL,
  scope            TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  google_email     TEXT,
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at   TIMESTAMPTZ,
  last_sync_error  TEXT
);

ALTER TABLE public.user_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Owners can read their own connection metadata (NOT the tokens —
-- the client never needs them, but a future "you're connected as
-- foo@gmail.com" UI surface would read google_email). Application
-- code that reads tokens uses service-role.
CREATE POLICY "ucc_select_own" ON public.user_calendar_connections
  FOR SELECT USING (auth.uid() = user_id);

-- Writes: service-role only. No INSERT/UPDATE/DELETE policy for
-- authenticated — RLS denies by default.

COMMENT ON TABLE public.user_calendar_connections IS
  'Per-user OAuth connection to an external calendar provider (Google for Phase 2). access_token_enc and refresh_token_enc are AES-256-GCM ciphertext produced by lib/calendar/token-encryption.ts using the CALENDAR_TOKEN_ENC_KEY env. Service-role writes only.';

-- ---------------------------------------------------------------------------
-- 2. trip_calendar_syncs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.trip_calendar_syncs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL CHECK (provider IN ('google')),
  -- For Google we use the user's primary calendar today ('primary').
  -- We store the resolved calendar id so a future "sync to a named
  -- calendar" UI doesn't need a migration.
  external_calendar_id  TEXT NOT NULL,
  -- How many events we successfully pushed in the last sync run.
  -- Powers the "Synced N events" toast copy.
  event_count           INT NOT NULL DEFAULT 0,
  last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                TEXT NOT NULL DEFAULT 'ok'
                          CHECK (status IN ('ok','partial','failed')),
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One sync record per (trip, provider, user) — a collaborator
  -- syncing the same trip to their own Google gets their own row.
  UNIQUE (trip_id, provider, user_id)
);

CREATE INDEX IF NOT EXISTS tcs_user_idx
  ON public.trip_calendar_syncs (user_id);

CREATE INDEX IF NOT EXISTS tcs_trip_idx
  ON public.trip_calendar_syncs (trip_id);

ALTER TABLE public.trip_calendar_syncs ENABLE ROW LEVEL SECURITY;

-- Owner OR collaborator on the trip can read sync records for that
-- trip — matches the access model of the trip itself (you can see
-- the trip, you can see its sync status).
CREATE POLICY "tcs_select_owner_or_collab"
  ON public.trip_calendar_syncs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_calendar_syncs.trip_id
        AND t.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.trip_collaborators tc
      WHERE tc.trip_id = trip_calendar_syncs.trip_id
        AND tc.user_id = auth.uid()
    )
  );

-- Writes: service-role only. The OAuth callback is the only writer
-- and runs with the admin client.

COMMENT ON TABLE public.trip_calendar_syncs IS
  'Per-(trip, provider, user) record of a one-shot calendar sync. Created by app/api/calendar/google/callback/route.ts after the OAuth dance succeeds and events are POSTed. RLS: trip owner + collaborators can read.';
