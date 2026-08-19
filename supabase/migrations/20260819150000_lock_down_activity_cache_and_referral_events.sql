-- Make destination_activity_cache and referral_events server-write-only.
--
-- NO CODE CHANGE AND NO DEPLOY ORDERING NEEDED, unlike
-- 20260819140000_google_places_cache_server_write_only.sql. Every writer of
-- both tables already uses the service role, which bypasses RLS:
--   destination_activity_cache — lib/ai/cache.ts,
--                                app/api/cron/cleanup-expired-cache
--   referral_events            — app/api/referral/click, lib/referral/completion
-- Audited by grepping every file that references each table; the only other
-- references are read-only (admin cost view, referral history, bananas).
--
-- BOTH CONFIRMED EXPLOITABLE with the public anon key before writing this:
--   destination_activity_cache  INSERT -> HTTP 201, row created
--   referral_events             INSERT -> HTTP 201, row created
-- Both probe rows were deleted afterwards.
--
-- A NOTE ON HOW THE referral_events PROBE NEARLY LIED
-- The first attempt returned 401 "new row violates row-level security policy"
-- and looked blocked. It was not: the probe sent `Prefer: return=representation`,
-- so PostgREST added a RETURNING, and RETURNING must satisfy the SELECT policy —
-- which scopes rows to auth.uid()'s own referral codes and therefore matches
-- nothing for anon. Dropping that header produced a 23514 CHECK violation on
-- event_type (proving RLS had allowed the write), and a valid 'click' event
-- then inserted with 201. Any write probe whose refusal and success look alike
-- has to be re-run before it is believed.
--
-- WHAT AN ATTACKER COULD DO
--   destination_activity_cache — poison AI-generated activity content that is
--   served into other users' itineraries. Same class as the places cache.
--
--   referral_events — NOT a way to mint rewards: the reward path keys off
--   users.referred_by_code / users.referral_completed_at and the referral_codes
--   lookup, and only WRITES referral_events as a record. But the table carries a
--   UNIQUE partial index on (referee_id) WHERE event_type='conversion', so a
--   pre-inserted row bearing a victim's referee_id would collide with their
--   legitimate conversion insert and block a real user's reward. Plus straight
--   pollution of referral analytics.
--
-- READS ARE LEFT ALONE on both tables. destination_activity_cache keeps its
-- public SELECT (cached activity text, nothing user-identifying, and the admin
-- cost view reads it); referral_events keeps the SELECT already scoped to the
-- caller's own referral codes. Only the write paths change.

-- ── destination_activity_cache ────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can insert destination_activity_cache" ON public.destination_activity_cache;
DROP POLICY IF EXISTS "Anyone can update destination_activity_cache" ON public.destination_activity_cache;

REVOKE INSERT, UPDATE, DELETE ON public.destination_activity_cache FROM anon, authenticated;

COMMENT ON TABLE public.destination_activity_cache IS
  'AI activity cache. SERVER-WRITE-ONLY: written only via the service role '
  '(lib/ai/cache.ts). anon/authenticated may SELECT only — they previously held '
  'INSERT and UPDATE with WITH CHECK (true), allowing content poisoning.';

-- ── referral_events ───────────────────────────────────────────────────────
-- Only the INSERT policy is public. The UPDATE policy is already correctly
-- restricted to service_role, and the SELECT policy is already owner-scoped;
-- both are left exactly as they are.
DROP POLICY IF EXISTS "Public can insert referral events" ON public.referral_events;

REVOKE INSERT, UPDATE, DELETE ON public.referral_events FROM anon, authenticated;

COMMENT ON TABLE public.referral_events IS
  'Referral funnel log. SERVER-WRITE-ONLY: written only via the service role '
  '(app/api/referral/click, lib/referral/completion). anon previously held a '
  'WITH CHECK (true) INSERT, which allowed forged events and — via the unique '
  'partial index on (referee_id) WHERE event_type=''conversion'' — could block a '
  'real user from ever claiming their referral.';
