-- Atomic reported_count increment — closes the auto-hide race in
-- /api/trips/[id]/report.
--
-- Previously the route did:
--   SELECT reported_count FROM trips WHERE id = ?
--   UPDATE trips SET reported_count = old + 1 WHERE id = ?
--   if new >= AUTO_HIDE_THRESHOLD: UPDATE trips SET is_hidden = true
--
-- Two concurrent reports both read N, both wrote N+1, so the counter
-- only advanced once and the threshold check could fire late (or
-- never, if a third concurrent write clobbered it again). Same TOCTOU
-- pattern that 20260524_atomic_counters.sql and 20260525_explore_ugc_feed.sql
-- fixed for like / save / fork / referral / template-copy.
--
-- Returns the post-update reported_count so the caller can compare
-- against AUTO_HIDE_THRESHOLD without a follow-up SELECT.
--
-- Deliberately does NOT recompute trending_score — a high report
-- count should not feed into trending (it would amplify abuse signals
-- back into the discovery surface).

CREATE OR REPLACE FUNCTION public.increment_trip_reported_count(
    p_trip_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET reported_count = COALESCE(reported_count, 0) + 1
    WHERE id = p_trip_id
    RETURNING reported_count INTO new_count;
    RETURN COALESCE(new_count, 0);
END;
$$;

-- Service-role only — anonymous + authenticated reporters hit the API
-- route, which uses the service client to insert into trip_reports
-- and bump the counter (trip_reports has no public RLS policies).
GRANT EXECUTE ON FUNCTION public.increment_trip_reported_count(UUID)
    TO service_role;

COMMENT ON FUNCTION public.increment_trip_reported_count IS
    'Atomic +1 on trips.reported_count. Returns the post-update count so /api/trips/[id]/report can fire the AUTO_HIDE_THRESHOLD check without a race.';
