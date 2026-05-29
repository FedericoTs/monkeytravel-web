-- Hostelworld 30-day stats aggregator.
--
-- Powers the social-proof counter on /backpacker. Encapsulated as an
-- RPC so the route handler does ONE call instead of three round-trips
-- (count + count distinct trip + count distinct visitor), and so the
-- query plan is hot in cache.
--
-- COALESCE(user_id::text, visitor_cookie) gives "unique people":
--   - logged-in users → one row per user no matter how many cookies
--   - anon visitors  → deduped by their mt_saver_cookie value
-- Mixed (same person logged in mid-session) still counts as one because
-- the user_id wins the COALESCE.
--
-- Returns BIGINT (Postgres COUNT default) → JS Number is safe up to
-- 2^53 which we won't approach for a 30-day click count.
--
-- SECURITY: invoked from service-role only (route handler uses the
-- service-role client). Marked SECURITY INVOKER so it inherits the
-- caller's RLS — service role bypasses RLS so the query sees all rows.
-- If this is ever exposed to anon clients, switch to SECURITY DEFINER
-- + add a check that callers can't enumerate visitor_cookies.

CREATE OR REPLACE FUNCTION public.hostelworld_stats_30d(since timestamptz)
RETURNS TABLE (
  clicks_30d         bigint,
  unique_trips_30d   bigint,
  unique_visitors_30d bigint
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    COUNT(*)                                                     AS clicks_30d,
    COUNT(DISTINCT trip_id)                                       AS unique_trips_30d,
    COUNT(DISTINCT COALESCE(user_id::text, visitor_cookie))       AS unique_visitors_30d
  FROM public.hostelworld_clicks
  WHERE created_at >= since;
$$;

-- Grant execute to service_role only (anon/authenticated have no need).
REVOKE ALL ON FUNCTION public.hostelworld_stats_30d(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hostelworld_stats_30d(timestamptz) TO service_role;
