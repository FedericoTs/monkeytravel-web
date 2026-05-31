-- Day-9 Supabase advisor sweep: tighten 7 over-permissive RLS policies
-- flagged as `rls_policy_always_true` by the Supabase security advisor.
-- Same family as the Day-7 P0 fix to email_subscribers (which made the
-- `WITH CHECK true` policy actually validate the payload).
--
-- Pattern across all changes: replace bare `true` with payload validation
-- + role attribution that matches actual privilege intent.

-- ============================================================
-- api_config — admin-only writes (was authenticated-only with bare true)
-- ============================================================
DROP POLICY IF EXISTS api_config_authenticated_insert ON public.api_config;
DROP POLICY IF EXISTS api_config_authenticated_update ON public.api_config;
CREATE POLICY api_config_admin_insert ON public.api_config
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_user());
CREATE POLICY api_config_admin_update ON public.api_config
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ============================================================
-- site_config — admin-only writes (was authenticated-only with bare true)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert site config" ON public.site_config;
DROP POLICY IF EXISTS "Authenticated users can update site config" ON public.site_config;
CREATE POLICY site_config_admin_insert ON public.site_config
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_user());
CREATE POLICY site_config_admin_update ON public.site_config
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ============================================================
-- email_subscribers — defense in depth on the open INSERT policy
-- (Day-7 made it permit anon; Day-9 makes it validate email format)
-- ============================================================
DROP POLICY IF EXISTS email_subscribers_anon_insert ON public.email_subscribers;
CREATE POLICY email_subscribers_anon_insert ON public.email_subscribers
  FOR INSERT TO anon, authenticated, service_role
  WITH CHECK (
    email IS NOT NULL
    AND length(email) BETWEEN 5 AND 254
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

-- ============================================================
-- page_views — require path populated + sane length
-- ============================================================
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.page_views;
CREATE POLICY page_views_anon_insert ON public.page_views
  FOR INSERT TO anon, authenticated, service_role
  WITH CHECK (
    path IS NOT NULL
    AND length(path) <= 2048
  );

-- ============================================================
-- trip_views — require trip_id present
-- ============================================================
DROP POLICY IF EXISTS "Public can insert trip views" ON public.trip_views;
CREATE POLICY trip_views_anon_insert ON public.trip_views
  FOR INSERT TO anon, authenticated, service_role
  WITH CHECK (trip_id IS NOT NULL);

-- ============================================================
-- referral_events — restrict UPDATE to service_role only
-- (was 'no role' = any caller could mutate referrer state)
-- ============================================================
DROP POLICY IF EXISTS "Service role can update referral events" ON public.referral_events;
CREATE POLICY referral_events_service_role_update ON public.referral_events
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

-- Force PostgREST reload so changes take effect without a deploy
NOTIFY pgrst, 'reload schema';
