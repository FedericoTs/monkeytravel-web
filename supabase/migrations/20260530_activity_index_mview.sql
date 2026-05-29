-- 20260530 — activity_index materialized view + trigram search
--
-- Why: /api/activities/search was SELECTing trips.id+title+itinerary LIMIT 100,
-- shipping the full JSONB payload to Node and looping with includes() — N+1ish
-- substring match, no fuzzy/typo/accent tolerance, no index possible. With 71
-- trips × ~24 activities each, each call already moves a few MB over the wire.
--
-- Fix: explode trips.itinerary into a flat materialized view, normalise text
-- (lower + unaccent), index name_norm / destination_norm with pg_trgm GIN,
-- and expose a STABLE RPC search_activities(q, dest, types, lim) that does the
-- work in Postgres. A SECURITY DEFINER refresh function is called nightly by
-- /api/cron/refresh-activity-index.
--
-- Bypassing RLS is intentional and mitigated by the WHERE clause:
--   visibility IN ('public','shared') AND is_hidden = false
-- — same surface the existing route already exposed.

-- 1. unaccent needed for accent-insensitive normalisation. pg_trgm already 1.6.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Drop any prior incarnation so the migration is idempotent under reapply.
DROP MATERIALIZED VIEW IF EXISTS public.activity_index CASCADE;

-- 3. Flat row per activity. row_key is md5(trip_id || day_idx || act_idx) so we
--    get a stable UNIQUE key (required for REFRESH MATERIALIZED VIEW CONCURRENTLY)
--    without depending on activity payload contents.
CREATE MATERIALIZED VIEW public.activity_index AS
SELECT
  md5(t.id::text || '|' || (day_ord.day_idx)::text || '|' || (act_ord.act_idx)::text) AS row_key,
  t.id AS trip_id,
  COALESCE(act->>'name', '') AS name,
  lower(public.unaccent(COALESCE(act->>'name', ''))) AS name_norm,
  COALESCE(act->>'type', 'attraction') AS type,
  COALESCE(act->>'description', '') AS description,
  act->>'address' AS address,
  act->>'location' AS location,
  lower(public.unaccent(
    COALESCE(act->>'location', '') || ' ' || COALESCE(act->>'address', '')
  )) AS destination_norm,
  act->'coordinates' AS coordinates,
  COALESCE((act->>'duration_minutes')::int, 90) AS duration_minutes,
  act->'estimated_cost' AS estimated_cost,
  act->>'image_url' AS image_url
FROM public.trips t,
     LATERAL jsonb_array_elements(t.itinerary) WITH ORDINALITY AS day_ord(day, day_idx),
     LATERAL jsonb_array_elements(day_ord.day->'activities') WITH ORDINALITY AS act_ord(act, act_idx)
WHERE t.itinerary IS NOT NULL
  AND jsonb_typeof(t.itinerary) = 'array'
  AND jsonb_typeof(day_ord.day->'activities') = 'array'
  AND COALESCE(act->>'name', '') <> ''
  AND COALESCE(t.is_hidden, false) = false
  AND COALESCE(t.visibility, 'private') IN ('public', 'shared');

-- 4. UNIQUE INDEX — required for CONCURRENT refresh.
CREATE UNIQUE INDEX activity_index_row_key_uq
  ON public.activity_index (row_key);

-- 5. Trigram GIN on the two text columns the route filters on.
CREATE INDEX activity_index_name_norm_trgm
  ON public.activity_index USING gin (name_norm public.gin_trgm_ops);

CREATE INDEX activity_index_destination_norm_trgm
  ON public.activity_index USING gin (destination_norm public.gin_trgm_ops);

CREATE INDEX activity_index_type_btree
  ON public.activity_index (type);

-- 6. Anon + authenticated need SELECT — RPC runs as caller via STABLE function,
--    not SECURITY DEFINER. Service role gets it automatically but be explicit.
GRANT SELECT ON public.activity_index TO anon, authenticated, service_role;

-- 7. Search function. STABLE so PostgREST can pool plans across calls.
--    Uses word_similarity (%>) for both destination + name so a short query
--    matches the closest contiguous run of words inside a long string —
--    plain similarity (%) compares whole strings and tanks to ~0.08 for
--    "lisbon" vs "alfama r. de santa cruz do castelo, 1100-129 lisboa,
--    portugal", which silently returned 0 rows in early prototyping.
--    When q is empty we skip the name filter entirely (category browse mode).
CREATE OR REPLACE FUNCTION public.search_activities(
  q text DEFAULT '',
  dest text DEFAULT '',
  types text[] DEFAULT NULL,
  lim int DEFAULT 10
)
RETURNS TABLE (
  row_key text,
  trip_id uuid,
  name text,
  type text,
  description text,
  address text,
  location text,
  coordinates jsonb,
  duration_minutes int,
  estimated_cost jsonb,
  image_url text,
  similarity real
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      lower(public.unaccent(COALESCE(q, ''))) AS q_norm,
      lower(public.unaccent(COALESCE(dest, ''))) AS dest_norm
  )
  SELECT
    a.row_key,
    a.trip_id,
    a.name,
    a.type,
    a.description,
    a.address,
    a.location,
    a.coordinates,
    a.duration_minutes,
    a.estimated_cost,
    a.image_url,
    CASE
      WHEN (SELECT q_norm FROM params) = '' THEN 1.0::real
      ELSE word_similarity((SELECT q_norm FROM params), a.name_norm)
    END AS similarity
  FROM public.activity_index a, params p
  WHERE
    -- Destination — operator direction matters: `haystack %> needle` returns
    -- TRUE iff the haystack contains a word with high trigram similarity to
    -- the needle. Threshold 0.5 lets "lisbon" → "lisboa" through but rejects
    -- unrelated cities. Index-backed by the GIN trgm index above.
    (p.dest_norm = '' OR (a.destination_norm %> p.dest_norm AND word_similarity(p.dest_norm, a.destination_norm) > 0.5))
    -- Name — same operator direction. 0.3 is forgiving enough for partial
    -- matches ("castle" → "São Jorge Castle") without overfetching.
    AND (
      p.q_norm = ''
      OR (a.name_norm %> p.q_norm AND word_similarity(p.q_norm, a.name_norm) > 0.3)
    )
    -- Type filter — caller passes the expanded category list (matches current route shape).
    AND (types IS NULL OR array_length(types, 1) IS NULL OR a.type = ANY(types))
  ORDER BY
    CASE WHEN (SELECT q_norm FROM params) = '' THEN 0 ELSE 1 END,
    similarity DESC,
    a.name
  LIMIT GREATEST(COALESCE(lim, 10), 1);
$$;

GRANT EXECUTE ON FUNCTION public.search_activities(text, text, text[], int)
  TO anon, authenticated, service_role;

-- 8. Refresh function. SECURITY DEFINER so the cron route (running as anon via
--    the public route, even though it auths with CRON_SECRET on the Node side)
--    can REFRESH without owning the MV. CONCURRENT means the index stays
--    queryable during refresh — requires the UNIQUE INDEX above.
CREATE OR REPLACE FUNCTION public.refresh_activity_index()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.activity_index;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_activity_index() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_activity_index() TO service_role;

-- 9. First populate. CONCURRENT can't run on a never-refreshed MV, so do a
--    plain REFRESH here as part of the migration.
REFRESH MATERIALIZED VIEW public.activity_index;
