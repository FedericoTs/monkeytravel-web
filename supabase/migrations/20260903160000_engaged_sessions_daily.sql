-- Daily engaged-session counts, to sit beside "unique visitors" on /admin.
--
-- WHY
-- ---
-- Measured 2026-09-03 on the population the dashboard already counts
-- (is_bot = false, i.e. through the bot-excluding view): 683 sessions, of
-- which 129 — 18.9% — ever kept a page VISIBLE for four seconds. The rest
-- never engage with anything.
--
-- That gap is not cosmetic. Sessions split by engagement behave completely
-- differently downstream:
--
--     engaged      129 sessions   14.7% reach the wizard
--     not engaged  554 sessions    1.3% reach the wizard
--
-- 554 unengaged sessions produced ONE generation between them. So "unique
-- visitors" on the traffic chart overstates the count of people who could
-- plausibly convert by roughly 5x, and every rate computed against it is
-- correspondingly deflated. The chart is not wrong — it is answering a
-- different question than the one being asked of it.
--
-- This exposes the honest denominator next to the raw one rather than
-- replacing it: an unengaged session is still a request that cost money to
-- serve, and "not engaged" is NOT proof of a bot (a real person who bounces
-- in three seconds looks identical). Both lines are true; they answer
-- different questions.
--
-- FORWARD-ONLY, AND THE UI MUST RESPECT IT
-- ----------------------------------------
-- session_engagement starts 2026-09-02. There is no way to reclassify
-- earlier traffic — the signal was never collected. This function therefore
-- returns rows ONLY from the first engagement onward, so the caller can tell
-- "no data" from "zero engaged sessions". Rendering the missing days as 0
-- would draw a cliff that never happened, which is precisely the kind of
-- artefact that has already cost this dashboard credibility twice.

CREATE OR REPLACE FUNCTION public.get_engaged_sessions_daily()
 RETURNS TABLE(date text, engaged_sessions bigint)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (e.first_engaged_at AT TIME ZONE 'UTC')::date::text AS date,
         count(*)::bigint                                    AS engaged_sessions
  FROM public.session_engagement e
  WHERE e.first_engaged_at >= CURRENT_DATE - 30
    -- Never emit a day that predates the signal itself.
    AND e.first_engaged_at >= (SELECT min(first_engaged_at) FROM public.session_engagement)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- The default EXECUTE grant lives on PUBLIC, so revoking from anon alone is a
-- no-op — see 20260901230000_revoke_geo_rpcs_from_public.sql, where four geo
-- RPCs were readable by anyone holding the public browser key because of
-- exactly this.
REVOKE EXECUTE ON FUNCTION public.get_engaged_sessions_daily() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_engaged_sessions_daily() TO service_role;

COMMENT ON FUNCTION public.get_engaged_sessions_daily() IS
  'Daily count of sessions that kept a page visible past the engagement threshold. Forward-only from 2026-09-02; emits no row for days before the signal existed, so callers must render those as absent rather than zero.';
