-- Make geocode_cache and distance_cache server-write-only.
--
-- ⚠️ Apply only AFTER c14e59d is live. That commit moved the sole anon writer of
-- each table (app/api/travel/geocode, app/api/travel/distance) onto the service
-- role via lib/supabase/cache-admin.ts. Applying this first would break their
-- cache writes.
--
-- WHAT WAS OPEN — verified with the public anon key, same method as
-- 20260819140000 (google_places_cache) and 20260819150000:
--   geocode_cache   "Anyone can insert into geocode cache"  INSERT WITH CHECK (true)
--                   "Anyone can update geocode cache"       UPDATE USING/CHECK (true)
--   distance_cache  "Anyone can insert into distance cache" INSERT WITH CHECK (true)
--                   "Anyone can update distance cache"      UPDATE USING/CHECK (true)
-- all granted to {anon,authenticated} on globally shared data.
--
-- WHY THESE TWO ARE ARGUABLY THE WORST OF THE SET
-- A poisoned place NAME is visible to whoever reads it. Poisoned COORDINATES
-- and TRAVEL TIMES are not: they flow into the scheduler that orders activities
-- and estimates transit, so a forged row silently distorts itineraries for
-- every user with no visible tell.
--
-- CURRENT STATE, WHICH MAKES THIS ZERO-RISK RATHER THAN MERELY LOW-RISK
-- Both tables hold 0 rows, and both upstream APIs have been switched off in
-- api_config since 2025-12-06 (google_geocoding.enabled = false,
-- google_distance_matrix.enabled = false), so both routes return 503 before
-- reaching their cache at all. There is nothing to break and no cached data to
-- lose. It also means the write path CANNOT be exercised end-to-end today —
-- unlike the places cache, where a live /api/places call was used to prove the
-- service-role write still landed. The evidence here is tsc, 363 passing tests,
-- and a code path structurally identical to the one verified on 2026-08-19.
--
-- Note the empty-but-writable state is a reason to close this, not to defer it:
-- an attacker could pre-seed poisoned rows now that would be served the moment
-- either API is re-enabled.
--
-- Reads are left alone on both tables (cached coordinates and distances are not
-- user-identifying, and the admin cost view reads them). Both already carry a
-- "Service role can manage ..." policy, which is untouched.

-- ── geocode_cache ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can insert into geocode cache" ON public.geocode_cache;
DROP POLICY IF EXISTS "Anyone can update geocode cache" ON public.geocode_cache;

REVOKE INSERT, UPDATE, DELETE ON public.geocode_cache FROM anon, authenticated;

COMMENT ON TABLE public.geocode_cache IS
  'Address -> coordinates cache. SERVER-WRITE-ONLY: written only via the '
  'service role (app/api/travel/geocode, lib/supabase/cache-admin.ts). anon '
  'previously held INSERT and UPDATE with WITH CHECK (true), which allowed '
  'forged coordinates to be served to every user.';

-- ── distance_cache ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can insert into distance cache" ON public.distance_cache;
DROP POLICY IF EXISTS "Anyone can update distance cache" ON public.distance_cache;

REVOKE INSERT, UPDATE, DELETE ON public.distance_cache FROM anon, authenticated;

COMMENT ON TABLE public.distance_cache IS
  'Route distance/duration cache. SERVER-WRITE-ONLY: written only via the '
  'service role (app/api/travel/distance, lib/supabase/cache-admin.ts). anon '
  'previously held INSERT and UPDATE with WITH CHECK (true), which allowed '
  'forged travel times to skew scheduled itineraries.';
