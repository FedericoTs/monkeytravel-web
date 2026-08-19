-- Make google_places_cache server-write-only. Closes a cache-poisoning hole.
--
-- ⚠️ DEPLOY ORDER: ship the application change FIRST, then apply this.
-- The five code paths that write this table were switched from the ANON client
-- to a service-role client (lib/supabase/places-cache-admin.ts). If this
-- migration lands before that deploy, every cache WRITE starts failing and we
-- pay Google for lookups we already had. Reads are unaffected either way.
--
-- WHAT WAS WRONG — verified against production, not inferred
-- RLS was already ENABLED on this table (so the usual "no RLS" reading is
-- wrong), but two of its three policies were wide open to `public`:
--
--   google_places_cache_public_insert   INSERT  WITH CHECK (true)
--   google_places_cache_public_update   UPDATE  USING (true), no WITH CHECK
--   "Anyone can read places cache"      SELECT  USING (true)
--
-- Probed with the public anon key over PostgREST:
--   * UPDATE of a row we did not create  -> HTTP 200, row rewritten
--   * INSERT of a new row                -> HTTP 201
--   * DELETE                             -> HTTP 204 but ZERO rows removed
--     (confirmed by re-counting: 1056 before, 1056 after) because there is no
--     DELETE policy. So cache *destruction* was never possible — only
--     poisoning. The probe row was removed afterwards; the table is back to
--     its original 1055 rows.
--
-- Impact of the poisoning path: cache keys are md5 of predictable strings, so
-- any entry is targetable, and the rows are global — one rewritten row serves
-- a forged place name, address, coordinates or photo URL to every user.
--
-- WHY DROP THE POLICIES *AND* REVOKE
-- Either alone would do it, but they fail differently and both are cheap.
-- Dropping the policies is what actually stops RLS from permitting the write;
-- revoking the grants means that if someone later re-adds a permissive policy
-- (easy to do from the Supabase UI), the table-level privilege is still gone.
--
-- WHY SELECT STAYS OPEN
-- The contents are public place data — names, addresses, coordinates, photo
-- URLs — and nothing user-identifying. Revoking read would also break the
-- admin cost view, which reads through a user-scoped client. The brief allows
-- keeping a public SELECT policy for exactly this reason, so it is kept.
--
-- PRECEDENT
-- The newer place caches, places_v2 and places_v2_lookup, already have RLS on
-- with ZERO policies and are written only via createAdminClient(). This brings
-- the older table in line with them rather than inventing a new pattern.

-- Already enabled in production; restated so a fresh database matches.
ALTER TABLE public.google_places_cache ENABLE ROW LEVEL SECURITY;

-- The two exploitable policies.
DROP POLICY IF EXISTS google_places_cache_public_insert ON public.google_places_cache;
DROP POLICY IF EXISTS google_places_cache_public_update ON public.google_places_cache;

-- DELETE is included even though no DELETE policy exists today: this removes
-- the privilege at the grant layer so a future permissive policy cannot
-- silently re-enable it.
REVOKE INSERT, UPDATE, DELETE ON public.google_places_cache FROM anon, authenticated;

-- Reads stay as they are. Restated idempotently so a fresh database ends up in
-- the same state as production rather than with no SELECT policy at all.
DROP POLICY IF EXISTS "Anyone can read places cache" ON public.google_places_cache;
CREATE POLICY "Anyone can read places cache"
  ON public.google_places_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON TABLE public.google_places_cache IS
  'Global Google Places cache. SERVER-WRITE-ONLY: writes go through the '
  'service role (lib/supabase/places-cache-admin.ts). anon/authenticated may '
  'SELECT only — they previously held INSERT/UPDATE, which allowed poisoning '
  'entries served to every user.';
