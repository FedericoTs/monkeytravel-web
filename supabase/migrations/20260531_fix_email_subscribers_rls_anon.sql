-- Day-7 P0 fix: /api/subscribe returned HTTP 500 on every request for
-- weeks. Root cause: the existing RLS policy "Anyone can subscribe with
-- email" had polroles=[0] (implicit PUBLIC pseudo-role). In Supabase's
-- role model the public pseudo-role doesn't propagate to `anon`, so
-- anon inserts hit "new row violates row-level security policy".
--
-- The route does `supabase.from('email_subscribers').insert({...})
-- .select('id, email').single()`. So we need TWO policies:
--   1. INSERT explicitly TO anon, authenticated, service_role
--   2. SELECT TO same roles so the RETURNING in the round-trip succeeds
--
-- Discovery path:
--   - Postgres logs showed "new row violates row-level security policy
--     for table email_subscribers" on every prod /api/subscribe POST.
--   - SET ROLE anon; INSERT ... reproduced the rejection at SQL layer.
--   - Old policy: permissive, INSERT, with_check=true, polroles=[0].
--     Sqaurely "should permit all" but doesn't because [0] != [anon].
--   - After this migration: SET ROLE anon; INSERT ... → returns the row.

DROP POLICY IF EXISTS "Anyone can subscribe with email" ON public.email_subscribers;

CREATE POLICY email_subscribers_anon_insert
  ON public.email_subscribers
  FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (true);

CREATE POLICY email_subscribers_anon_select
  ON public.email_subscribers
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true);

-- Force PostgREST to reload its schema cache so the policy change
-- takes effect without waiting for the next deploy.
NOTIFY pgrst, 'reload schema';

COMMENT ON POLICY email_subscribers_anon_insert ON public.email_subscribers IS
  'Day-7 P0: explicit TO anon, ... — the implicit-public (polroles=[0]) policy did not propagate to anon role and every /api/subscribe POST 500-ed with RLS rejection. See route at app/api/subscribe/route.ts.';

COMMENT ON POLICY email_subscribers_anon_select ON public.email_subscribers IS
  'Day-7 P0 follow-up: /api/subscribe does .insert(...).select() to round-trip the inserted row id, which requires SELECT RLS to permit reading the just-written row.';
