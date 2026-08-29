-- Restore the four admin-dashboard metric RPCs, in git this time.
--
-- WHAT WAS WRONG
-- --------------
-- app/api/admin/stats/route.ts calls fourteen RPCs. Four of them did not
-- exist in the database:
--
--   get_user_metrics  get_trip_metrics  get_ai_usage_metrics  get_subscriber_metrics
--
-- They appear in no migration and in no commit in this repository's history,
-- so they were created by hand in the Supabase dashboard and lost at some
-- point since. That is the same class of problem scripts/rls-baseline.mts
-- exists to catch: production behaviour that no code review ever saw and no
-- diff records.
--
-- WHY NOBODY NOTICED
-- ------------------
-- The route wraps every call in Promise.allSettled and a safe() helper, and
-- a PostgREST .rpc() error RESOLVES rather than rejecting. So four failing
-- calls produced `{ data: null }`, the route silently fell through to its
-- fetch*Direct fallbacks, and the dashboard rendered. Exactly the swallow
-- that hid 24,680 visitors as zeros for three months (17ed7f2 / 039fff8).
--
-- The fallbacks are cheap today because the tables are small — 482 users,
-- 417 trips, 374 ai_usage, 18 subscribers. They stop being cheap, and start
-- being WRONG, the moment any table passes PostgREST's 1000-row default: the
-- response truncates silently and the metric is understated rather than slow.
-- ai_usage is growing ~76/month, so that is roughly eight months out.
--
-- A CORRECTNESS BUG, NOT JUST A PERFORMANCE ONE
-- ---------------------------------------------
-- fetchTripMetricsDirect selects from trips with no deleted_at filter, so
-- soft-deleted trips are counted as real. Measured today: the dashboard
-- reports 417 trips when 394 are live — 23 tombstones, a 5.8% overstatement.
-- These functions filter deleted_at properly, and the fallbacks in the route
-- are fixed in the same commit so the two paths cannot disagree.
--
-- RETURN SHAPE
-- ------------
-- Each returns a single jsonb OBJECT whose keys match the fallback's return
-- value exactly, camelCase included, because the route consumes them
-- interchangeably:
--
--   const userMetrics = usersResult.data || (await fetchUserMetricsDirect(...))
--
-- A jsonb object (not a SETOF row) is what makes `.rpc()` hand back an object
-- rather than an array, which is what that line needs.
--
-- SECURITY
-- --------
-- INVOKER, not DEFINER: the only caller is the admin route using the
-- service-role key, which already reads these tables. Elevating would grant
-- reach these functions do not need. EXECUTE goes to service_role only —
-- these are cross-user business metrics and have no place being callable by
-- anon or authenticated. (Several older analytics RPCs are granted to anon;
-- that predates this file and is not changed here.)

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total',            COUNT(*),
    'newLast7Days',     COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'),
    'newLast30Days',    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'),
    -- last_sign_in_at is nullable for users who never returned; FILTER
    -- already excludes NULLs, so no COALESCE is needed.
    'activeLast30Days', COUNT(*) FILTER (WHERE last_sign_in_at > NOW() - INTERVAL '30 days')
  )
  FROM users;
$$;

CREATE OR REPLACE FUNCTION public.get_trip_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total',       COUNT(*),
    'last7Days',   COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'),
    'last30Days',  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'),
    'sharedTrips', COUNT(*) FILTER (WHERE share_token IS NOT NULL)
  )
  -- The filter the old fallback lacked. Tombstones are not trips.
  FROM trips
  WHERE deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_usage_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total',      COUNT(*),
    'last7Days',  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'),
    'last30Days', COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')
  )
  FROM ai_usage;
$$;

CREATE OR REPLACE FUNCTION public.get_subscriber_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total',        COUNT(*),
    'last7Days',    COUNT(*) FILTER (WHERE subscribed_at > NOW() - INTERVAL '7 days'),
    'last30Days',   COUNT(*) FILTER (WHERE subscribed_at > NOW() - INTERVAL '30 days'),
    -- `verified` is a plain boolean; FILTER on it directly rather than on
    -- verified_at, which the previous fallback also did not consult.
    'verified',     COUNT(*) FILTER (WHERE verified),
    'unsubscribed', COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)
  )
  FROM email_subscribers;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which would expose
-- cross-user counts to anon. Revoke first, then grant only what calls them.
REVOKE ALL ON FUNCTION public.get_user_metrics()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_trip_metrics()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ai_usage_metrics()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_subscriber_metrics() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_user_metrics()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trip_metrics()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_metrics()   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_subscriber_metrics() TO service_role;

COMMENT ON FUNCTION public.get_user_metrics() IS
  'Admin dashboard user counts. Returns a jsonb object keyed to match fetchUserMetricsDirect in app/api/admin/stats/route.ts.';
COMMENT ON FUNCTION public.get_trip_metrics() IS
  'Admin dashboard trip counts, EXCLUDING soft-deleted trips. The old direct-query fallback counted tombstones and overstated the total by 5.8%.';
COMMENT ON FUNCTION public.get_ai_usage_metrics() IS
  'Admin dashboard AI usage counts. Returns a jsonb object keyed to match fetchAiMetricsDirect.';
COMMENT ON FUNCTION public.get_subscriber_metrics() IS
  'Admin dashboard email-subscriber counts. Returns a jsonb object keyed to match fetchSubscriberMetricsDirect.';
