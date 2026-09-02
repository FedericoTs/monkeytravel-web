-- One row per session that a human actually spent time in.
--
-- WHY THIS EXISTS
-- ---------------
-- `page_views.is_bot` is a user-agent regex, and the traffic that doubled the
-- wizard denominator on 2026-08-17 defeats it completely: 629 localized step-1
-- sessions from CN/SG/HK share only 29 user-agent strings, rotate through
-- Chrome 145-151, and 0.0% of them are flagged. Across 30 days those three
-- regions account for ~29,500 page views and SIX sessions that ever had an
-- account (CN: zero out of 3,335). They present as the #3 and #4 markets on
-- the /admin traffic dashboard.
--
-- Identity cannot separate them — the user agents are ordinary and the pool
-- rotates. Timing cannot either: a candidate rule ("2+ page views spanning
-- under 5 seconds") caught only 34% of the suspect sessions while catching
-- 23.9% of real ES/IT/BR/MX ones, because page-view timestamps are dominated
-- by Next.js prefetch rather than by reading.
--
-- What does separate them is ENGAGEMENT, and outside the wizard nothing
-- measured it: a blog reader and a scraper both produce page-view rows and
-- nothing else, so they were indistinguishable by construction. The wizard has
-- had `step1_heartbeat` for exactly this reason since Phase 0.3; this is the
-- same idea for every other page.
--
-- A row lands only when a real browser keeps the page VISIBLE for a few
-- seconds and runs a timer to completion. Prefetched documents never execute
-- client effects at all, and headless fetchers overwhelmingly do not linger.
--
-- Deliberately minimal: one row per session, first engagement only. It is a
-- qualifier for counting sessions, not a behavioural log, and it holds no
-- personal data beyond the session cookie the funnel already uses.
--
-- FORWARD-ONLY. Historical rows cannot be reclassified — the signal was never
-- collected — so dashboards should show this alongside the raw counts rather
-- than retro-fitting the past.

CREATE TABLE IF NOT EXISTS public.session_engagement (
  session_id        text PRIMARY KEY,
  first_engaged_at  timestamptz NOT NULL DEFAULT now(),
  first_path        text,
  locale            text
);

CREATE INDEX IF NOT EXISTS session_engagement_first_engaged_idx
  ON public.session_engagement (first_engaged_at DESC);

ALTER TABLE public.session_engagement ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy at all: the only writer is the API route via
-- the service-role client, and the only readers are service-role analytics.
-- RLS on with zero policies means "deny everyone else", which is the intent.

REVOKE ALL ON public.session_engagement FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.session_engagement TO service_role;

-- Engaged session counts for a window. service_role only, like the other
-- admin readers (the default EXECUTE grant lives on PUBLIC, so it must be
-- revoked explicitly — see 20260901230000).
CREATE OR REPLACE FUNCTION public.get_engaged_sessions(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(engaged_sessions bigint, engaged_with_locale bigint)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(*)::bigint,
         count(*) filter (where locale is not null and locale <> 'en')::bigint
  from public.session_engagement
  where first_engaged_at >= p_from and first_engaged_at < p_to;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_engaged_sessions(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_engaged_sessions(timestamptz, timestamptz) TO service_role;
