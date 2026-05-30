-- 20260601 — users.calendar_hmac column for the subscription feed
--
-- Background
-- ----------
-- Phase 1B of the calendar-export feature (see
-- docs/specs/calendar-export-smart-notifs.md) ships a dynamic .ics
-- subscription feed at /api/calendar/[user_hmac].ics. Calendar clients
-- (Apple, Google, Outlook) poll the URL hourly and pick up trip
-- changes without the user re-importing anything.
--
-- The URL needs a stable, hard-to-guess identifier for the user that
-- isn't the user_id itself (don't want to leak that publicly, and
-- don't want it brute-forceable). HMAC(user_id, CALENDAR_HMAC_SECRET)
-- gives both — stable for the user, unguessable without the secret,
-- and rotatable by re-issuing the secret (which forces all users to
-- regenerate their feed URLs — acceptable for a rotation event).
--
-- Storage strategy
-- ----------------
-- We add a nullable `calendar_hmac TEXT UNIQUE` column to users. The
-- HMAC itself is computed in Node (lib/calendar/feed.ts) using
-- node:crypto — NOT in Postgres — because:
--   1. The secret lives in Vercel env, not in any pg setting / GUC,
--      so we'd need a one-off backfill anyway.
--   2. Computing in Node keeps the secret out of pg_stat_statements
--      / Supabase audit logs.
--
-- Population is lazy: getOrCreateUserHmac(userId) mints + writes via
-- service-role on first need (typically the first time the user
-- opens the AddToCalendar "Subscribe" tab; Phase 2 wiring). The feed
-- route itself only reads — if no matching row exists for the HMAC
-- it 404s. Lookups go through the UNIQUE index → O(1).
--
-- CAUSALITY
-- ---------
-- - lib/calendar/feed.ts owns the HMAC compute + look-up surface.
-- - app/api/calendar/[user_hmac]/route.ts is the only reader.
-- - app/robots.ts disallows /api/calendar/* so personalised .ics URLs
--   don't get crawled.
-- - No FK fan-out: column is on users with ON DELETE behaviour
--   inherited from the row itself.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS calendar_hmac TEXT;

-- UNIQUE so we can look up by HMAC in O(1) and so two users can never
-- collide (we'd have a SHA-256 collision before that happens, but the
-- constraint also catches accidental key-rotation backfill bugs).
-- Partial index — most users won't have a feed minted, no need to
-- carry NULLs in the index.
CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_hmac_idx
  ON public.users (calendar_hmac)
  WHERE calendar_hmac IS NOT NULL;

COMMENT ON COLUMN public.users.calendar_hmac IS
  'HMAC-SHA256(user_id, CALENDAR_HMAC_SECRET) — opaque identifier for the user''s personal .ics subscription feed at /api/calendar/<calendar_hmac>.ics. Lazily populated by lib/calendar/feed.ts:getOrCreateUserHmac on first feed-URL mint. Rotating CALENDAR_HMAC_SECRET requires nulling this column to force regeneration.';
