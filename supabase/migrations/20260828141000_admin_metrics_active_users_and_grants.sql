-- Two defects in 20260828140000, both found by verifying the result instead of
-- trusting the migration.
--
-- 1. activeLast30Days was always 0.
--    It read public.users.last_sign_in_at, which is NULL for all 482 rows —
--    the column exists and nothing writes it. auth.users holds the real value:
--    419 populated, 129 active in the last 30 days, most recent today. So the
--    dashboard reported 0 active users when the answer was 129, and the
--    TypeScript fallback read the same dead column, so BOTH paths were wrong
--    and had been for as long as the panel existed.
--
--    Reading auth.users needs elevated rights, so this function becomes
--    SECURITY DEFINER. EXECUTE is service_role only, so widening the
--    function's rights does not widen who may call it.
--
-- 2. The REVOKE in the previous migration did nothing.
--    Supabase ships ALTER DEFAULT PRIVILEGES granting EXECUTE on new public
--    functions to anon and authenticated. `REVOKE ... FROM PUBLIC` does not
--    remove a role-specific grant, so after that migration all four functions
--    still reported anon=true — cross-user business counts callable with the
--    public anon key. Role-specific grants need role-specific revokes.
--
--    Same default-grant shape that made public_profiles anon-writable in the
--    2026-08-21 tenant-guard run. Worth assuming it applies to every new
--    function in this schema.

CREATE OR REPLACE FUNCTION public.get_user_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total',            (SELECT COUNT(*) FROM public.users),
    'newLast7Days',     (SELECT COUNT(*) FROM public.users
                          WHERE created_at > NOW() - INTERVAL '7 days'),
    'newLast30Days',    (SELECT COUNT(*) FROM public.users
                          WHERE created_at > NOW() - INTERVAL '30 days'),
    -- auth.users, NOT public.users: the public mirror is never written.
    -- Joined to public.users so a deleted profile is not counted.
    'activeLast30Days', (SELECT COUNT(*) FROM auth.users a
                          JOIN public.users u ON u.id = a.id
                          WHERE a.last_sign_in_at > NOW() - INTERVAL '30 days')
  );
$$;

REVOKE ALL ON FUNCTION public.get_user_metrics()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_trip_metrics()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_usage_metrics()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_subscriber_metrics() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_metrics()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trip_metrics()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_metrics()   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_subscriber_metrics() TO service_role;

COMMENT ON FUNCTION public.get_user_metrics() IS
  'Admin dashboard user counts. activeLast30Days comes from auth.users.last_sign_in_at because the public.users mirror of that column is NULL for every row and always has been. SECURITY DEFINER for the auth schema read; EXECUTE is service_role only.';
