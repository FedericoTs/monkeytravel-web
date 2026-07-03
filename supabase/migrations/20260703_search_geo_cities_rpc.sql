-- Prefix-first + population-ranked city search over geo_cities (task #372).
-- q MUST be pre-normalized by the caller (lowercased, diacritics-stripped,
-- wildcard chars removed) to match the normalized search_text column.
-- Applied to prod (sevfbahwmlbdlnbhqwyi) 2026-07-03 via MCP apply_migration.
CREATE OR REPLACE FUNCTION public.search_geo_cities(q text, lim int DEFAULT 8)
RETURNS TABLE (
  id bigint, name text, ascii_name text, country_code text,
  latitude double precision, longitude double precision, population integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id, name, ascii_name, country_code, latitude, longitude, population
  FROM public.geo_cities
  WHERE q <> '' AND search_text LIKE '%' || q || '%'
  ORDER BY (search_text LIKE q || '%') DESC,  -- name/prefix matches first
           population DESC
  LIMIT LEAST(GREATEST(lim, 1), 12);
$$;

-- SECURITY INVOKER (default): runs as the caller; geo_cities RLS is USING(true)
-- so anon can read. Reference-data read only — safe to grant to anon.
REVOKE ALL ON FUNCTION public.search_geo_cities(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.search_geo_cities(text, int)
  TO anon, authenticated, service_role;
