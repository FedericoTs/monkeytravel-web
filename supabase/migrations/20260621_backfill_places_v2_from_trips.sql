-- 2026-06-21 — One-time DATA backfill: warm places_v2 from historical trips.
--
-- Applied to prod via execute_sql on 2026-06-21 (inserted 202 new place rows).
-- This file is the canonical record + replay path. NOTE: this is a data
-- backfill, not a schema migration — it reads prod `trips` content, so replaying
-- it on an empty staging/dev DB is a no-op (nothing to extract). Kept here so
-- the operation is documented and re-runnable against a populated DB.
--
-- WHY
--   Saved trip itineraries embed the resolved activity photo as
--     image_url = /api/places/photo?name=places%2F<PLACE_ID>%2Fphotos%2F<TOKEN>&w=..&h=..
--   i.e. every Google-sourced activity already carries its canonical Google
--   place_id + a working photo resource name. 760 such activities exist across
--   all trips (575 distinct place_ids), of which 202 were NOT yet in places_v2.
--
--   Paired with the getOrFetchPlace place_id-dedup change (lib/images/activity.ts):
--   after Text Search reveals a place_id, we check places_v2 by id and SKIP the
--   $17/1K Place Details Pro call when the place is already cached (incl. these
--   backfilled rows). So pre-warming places_v2 means the next time any of these
--   202 places appears in a trip (under any name variant) we pay only the cheap
--   $5/1K Text Search, not the full $22/1K.
--
--   place_id is unambiguous, so this backfill is safe and idempotent
--   (ON CONFLICT DO NOTHING — the existing ~3,405 rows are never modified).
--   display_name carries Gemini's activity title rather than the Google place
--   name; that field is cosmetic cache metadata and is never rendered.

WITH days AS (
  SELECT jsonb_array_elements(
           CASE WHEN jsonb_typeof(t.itinerary->'days')='array' THEN t.itinerary->'days'
                WHEN jsonb_typeof(t.itinerary)='array' THEN t.itinerary
                ELSE '[]'::jsonb END
         ) AS day
  FROM trips t
  WHERE t.deleted_at IS NULL AND t.itinerary IS NOT NULL
),
acts AS (
  SELECT jsonb_array_elements(day->'activities') AS a
  FROM days WHERE jsonb_typeof(day->'activities')='array'
),
extracted AS (
  SELECT
    substring(a->>'image_url' from 'name=places%2F([^%]+)%2Fphotos') AS place_id,
    replace(substring(a->>'image_url' from 'name=([^&]+)'), '%2F', '/') AS photo_resource_name,
    a->>'image_url' AS photo_url,
    a->>'name' AS display_name,
    a->>'address' AS formatted_address,
    NULLIF(a->'coordinates'->>'lat','')::numeric AS latitude,
    NULLIF(a->'coordinates'->>'lng','')::numeric AS longitude
  FROM acts
),
deduped AS (
  SELECT DISTINCT ON (place_id)
    place_id, photo_resource_name, photo_url, display_name, formatted_address, latitude, longitude
  FROM extracted
  WHERE place_id IS NOT NULL AND length(place_id) > 5
    AND photo_resource_name LIKE 'places/%/photos/%'
  ORDER BY place_id, length(photo_resource_name) DESC  -- prefer the most complete photo token
)
INSERT INTO places_v2 (place_id, display_name, formatted_address, latitude, longitude, photo_resource_name, photo_url, updated_at)
SELECT place_id, display_name, formatted_address, latitude, longitude, photo_resource_name, photo_url, now()
FROM deduped
ON CONFLICT (place_id) DO NOTHING;
