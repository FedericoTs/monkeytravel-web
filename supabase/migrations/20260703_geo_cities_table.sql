-- UX10X Phase 1 (task #372) — local population-ranked city table that replaces
-- the fragile Photon dependency for wizard destination autocomplete.
-- Seeded from GeoNames cities5000 (CC-BY 4.0, ~69k cities >5k pop) via the
-- one-shot edge function supabase/functions/seed-geo-cities.
-- Applied to prod (sevfbahwmlbdlnbhqwyi) 2026-07-03 via MCP apply_migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.geo_cities (
  id            bigint PRIMARY KEY,              -- geonameid
  name          text NOT NULL,                   -- display name (GeoNames preferred)
  ascii_name    text NOT NULL,
  country_code  text NOT NULL,                   -- ISO-3166 alpha-2
  admin1        text,
  latitude      double precision,
  longitude     double precision,
  population    integer NOT NULL DEFAULT 0,
  feature_code  text,                            -- PPL, PPLC, PPLA, ...
  -- normalized (lowercase, diacritics-stripped) name + ascii + up to 20 filtered
  -- Latin native alternate names, space-joined. The match surface: an Italian
  -- typing "firenze" hits the alt token; ranking is population DESC so the real
  -- city (Málaga ES 592k) outranks tiny same-name towns.
  search_text   text NOT NULL
);

CREATE INDEX IF NOT EXISTS geo_cities_search_trgm
  ON public.geo_cities USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS geo_cities_pop_idx
  ON public.geo_cities (population DESC);

ALTER TABLE public.geo_cities ENABLE ROW LEVEL SECURITY;

-- Public reference data (city names only). Anon read = the wizard autocomplete
-- runs on the request-scoped anon client, same as the `destinations` table.
DROP POLICY IF EXISTS geo_cities_read_all ON public.geo_cities;
CREATE POLICY geo_cities_read_all ON public.geo_cities
  FOR SELECT TO public USING (true);
GRANT SELECT ON public.geo_cities TO anon, authenticated;
