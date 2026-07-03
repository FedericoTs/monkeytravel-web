-- UX10X Master Plan Phase 0.5 — baseline dashboard data layer.
--
-- Two objects that back /api/admin/ux10x-baseline (the admin "North Star"
-- card). Both are read ONLY by the service-role admin route; anon/authenticated
-- are explicitly revoked so nothing leaks through PostgREST.
--
--   1. vw_ux10x_daily_baseline — one row per day (rolling 90d) with the core
--      funnel counts the plan tracks: anonymous wizard starts, saves, trips
--      created, trips shared, AI conversations.
--   2. get_ux10x_rates(lo, hi) — the two rate/North-Star numbers that need a
--      window: the pure-wizard step1->2 conversion % (front-door decision arm
--      EXCLUDED so its different top-of-funnel doesn't distort the rate) and
--      Weekly Active Crews (distinct trips a SECOND human actively engaged —
--      voted or joined — within [lo, hi); today ~0, the whole point).
--
-- Definitions locked against live data 2026-07-03:
--   * step tokens: 'step_1_destination_dates' -> 'step_2_vibes' (classic
--     wizard). Decision arm has its own first_value/options_* steps.
--   * 'saved' events fire only post-auth (a real conversion), distinct from
--     rows in `trips` (which also include template seeds, forks, imports).
--   * trips.shared_at is the continuous share signal (has history; the
--     funnel_events.share_link_created event only starts 2026-07-03).
--
-- Applied to prod (sevfbahwmlbdlnbhqwyi) 2026-07-03 via MCP apply_migration
-- BEFORE the route deploy, so the route never queries a missing object.

-- ---------------------------------------------------------------------------
-- 1. Daily baseline view (rolling 90 days, UTC day buckets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_ux10x_daily_baseline
WITH (security_invoker = true) AS
WITH days AS (
  SELECT generate_series(
           date_trunc('day', now() - interval '90 days'),
           date_trunc('day', now()),
           interval '1 day'
         )::date AS day
),
step1 AS (
  -- Anonymous funnel starts: distinct sessions that reached the wizard's
  -- first real step while logged out (either front-door arm).
  SELECT created_at::date AS day, count(DISTINCT session_id) AS n
  FROM public.wizard_step_events
  WHERE step = 'step_1_destination_dates'
    AND user_id IS NULL
    AND session_id IS NOT NULL
  GROUP BY 1
),
saves AS (
  -- Wizard conversions: the 'saved' step fires only after auth.
  SELECT created_at::date AS day, count(*) AS n
  FROM public.wizard_step_events
  WHERE step = 'saved'
  GROUP BY 1
),
tcreated AS (
  -- Trip rows materialised that day, excluding curated template seeds and
  -- soft-deleted rows.
  SELECT created_at::date AS day, count(*) AS n
  FROM public.trips
  WHERE COALESCE(is_template, false) = false
    AND deleted_at IS NULL
  GROUP BY 1
),
tshared AS (
  SELECT shared_at::date AS day, count(*) AS n
  FROM public.trips
  WHERE shared_at IS NOT NULL
  GROUP BY 1
),
aiconv AS (
  SELECT created_at::date AS day, count(*) AS n
  FROM public.ai_conversations
  GROUP BY 1
)
SELECT
  d.day,
  COALESCE(s1.n, 0) AS anon_step1_sessions,
  COALESCE(sv.n, 0) AS saves,
  COALESCE(tc.n, 0) AS trips_created,
  COALESCE(ts.n, 0) AS trips_shared,
  COALESCE(ai.n, 0) AS ai_conversations
FROM days d
LEFT JOIN step1    s1 ON s1.day = d.day
LEFT JOIN saves    sv ON sv.day = d.day
LEFT JOIN tcreated tc ON tc.day = d.day
LEFT JOIN tshared  ts ON ts.day = d.day
LEFT JOIN aiconv   ai ON ai.day = d.day
ORDER BY d.day DESC;

-- Admin route uses the service-role client (BYPASSRLS). Keep anon/authenticated
-- out entirely; grant the service role explicitly.
REVOKE ALL ON public.vw_ux10x_daily_baseline FROM anon, authenticated;
GRANT SELECT ON public.vw_ux10x_daily_baseline TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Windowed rates + North Star
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ux10x_rates(lo timestamptz, hi timestamptz)
RETURNS TABLE (step1_to_2_pct numeric, weekly_active_crews integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH w AS (
    -- Pure wizard arm only (exclude the decision front-door arm; its
    -- options_*/first_value steps are a different funnel and would distort
    -- the step1->2 rate).
    SELECT session_id,
           bool_or(step = 'step_1_destination_dates') AS s1,
           bool_or(step = 'step_2_vibes')             AS s2
    FROM public.wizard_step_events
    WHERE (front_door IS NULL OR front_door = 'wizard')
      AND created_at >= lo AND created_at < hi
      AND session_id IS NOT NULL
    GROUP BY session_id
  ),
  rate AS (
    SELECT round(
             100.0 * count(*) FILTER (WHERE s1 AND s2)
             / nullif(count(*) FILTER (WHERE s1), 0), 1) AS pct
    FROM w
  ),
  crews AS (
    -- A "crew" = a trip a SECOND human actively engaged with in the window:
    -- an anonymous vote, a funnel vote_cast, or a collaborator joining.
    -- Passive share visits are intentionally excluded (they feed the loop but
    -- don't prove group decision-making).
    SELECT count(DISTINCT trip_id) AS n
    FROM (
      SELECT trip_id FROM public.anonymous_activity_votes
        WHERE created_at >= lo AND created_at < hi AND trip_id IS NOT NULL
      UNION
      SELECT trip_id FROM public.funnel_events
        WHERE event_type = 'vote_cast'
          AND created_at >= lo AND created_at < hi AND trip_id IS NOT NULL
      UNION
      SELECT trip_id FROM public.trip_collaborators
        WHERE joined_at >= lo AND joined_at < hi AND trip_id IS NOT NULL
    ) x
  )
  SELECT
    COALESCE((SELECT pct FROM rate), 0)::numeric AS step1_to_2_pct,
    COALESCE((SELECT n FROM crews), 0)::integer  AS weekly_active_crews;
$$;

-- Anon must not be able to execute this (Phase-0 security posture: no anon
-- EXECUTE on analytics functions). Route calls it via service role.
REVOKE ALL ON FUNCTION public.get_ux10x_rates(timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ux10x_rates(timestamptz, timestamptz) TO service_role;
