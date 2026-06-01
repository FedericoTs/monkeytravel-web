-- 2026-06-01 — place_id-keyed cache for Google Places lookups.
--
-- Cost-reduction pass on the trip-generation pipeline (task #367).
--
-- Background:
--   Current activity-image cache (google_places_cache with cache_type
--   'activity_image') is keyed on a normalized name like "colosseum|rome".
--   Name variants ("Colosseo", "The Roman Colosseum", "Coliseum") MISS the
--   cache → pay Text Search Pro ($32/1K) again on every variant. Photo
--   delivery is a separate $7/1K Place Photos call.
--
--   For a typical 5-day trip with ~15 unique activities, fresh-lookup cost
--   is ~$0.37 (15 × ($32 + $7)/1K). At low cache hit rate this dominates
--   our Google Cloud bill.
--
-- Fix:
--   Cache by canonical Google place_id. All name variants ever seen
--   resolve to the same place_id, so a single paid lookup ever covers any
--   future name spelling. Place IDs are explicitly exempt from Google's
--   cache-expiry policy (https://developers.google.com/maps/documentation/
--   places/web-service/policies) — we can store indefinitely.
--
-- Tables:
--   places_v2          One row per Google place_id. Source of truth for
--                      display_name, address, coords, photo URL.
--   places_v2_lookup   Many normalized_key → one place_id. Many name
--                      variants collapse to one cache row.
--
-- This is parallel infra. The existing google_places_cache continues
-- serving traffic until its TTL expires (365d). No migration of
-- historical rows needed. No downtime.
--
-- Already applied to prod via mcp__apply_migration on 2026-06-01.
-- This file is the canonical record + replay path for staging/dev.

CREATE TABLE IF NOT EXISTS places_v2 (
  place_id            text PRIMARY KEY,
  display_name        text NOT NULL,
  formatted_address   text,
  latitude            numeric(10,7),
  longitude           numeric(10,7),
  photo_resource_name text,
  photo_url           text,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  hit_count           integer NOT NULL DEFAULT 0,
  last_accessed_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS places_v2_lookup (
  normalized_key    text PRIMARY KEY,
  place_id          text NOT NULL REFERENCES places_v2(place_id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  hit_count         integer NOT NULL DEFAULT 0,
  last_accessed_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS places_v2_lookup_place_id_idx ON places_v2_lookup(place_id);
CREATE INDEX IF NOT EXISTS places_v2_updated_idx ON places_v2(updated_at DESC);
CREATE INDEX IF NOT EXISTS places_v2_hit_count_idx ON places_v2(hit_count DESC);

-- Server-side cache only. No anon / authenticated access.
ALTER TABLE places_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE places_v2_lookup ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE places_v2 IS 'Google Places API cache keyed by real place_id. Indefinite retention per Places TOS exemption for place_id. Populated by lib/images/activity.ts.';
COMMENT ON TABLE places_v2_lookup IS 'Many normalized name keys map to one place_id. Collapses name variants ("Colosseo", "The Colosseum") to a single cached entry.';
