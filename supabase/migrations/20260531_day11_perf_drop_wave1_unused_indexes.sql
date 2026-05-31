-- Migration: Drop unused indexes -- Wave 1 (cache / lookup / legacy tables)
-- Date: 2026-05-31
-- Author: Day-11 perf-advisor cleanup (task #348)
--
-- Lint addressed: unused_index (0005) -- Supabase performance advisor flagged 113
-- indexes as never used since pg_stat reset.
--
-- Wave classification policy:
--   WAVE 1 (this file) -- SAFE to drop:
--     * Cache / API-response lookup tables (destinations, *_cache, fcdo_advisory_cache):
--       write-heavy ingest paths, old query patterns no longer in use; dropping them
--       removes maintenance overhead without risking user-facing query plans.
--     * Legacy/dormant tables (tester_codes, email_subscribers): pre-launch features
--       no longer queried.
--   WAVE 2 (deferred) -- HOLD for query-trace analysis:
--     * Hot user-facing tables (users, trips, trip_collaborators, trip_invites,
--       trip_expenses, trip_expense_splits).
--     * Recently-added feature tables (wizard_step_events, device_tokens, push_log,
--       scheduled_notifications, banana_*, mcp_itineraries, activity_*,
--       activity_timelines, trip_calendar_syncs, hostelworld_clicks, trip_reports,
--       trip_likes, trip_saves, trip_views, notifications, proposal_votes,
--       trip_checklists, contact_messages, api_request_logs, api_config, ai_prompts,
--       site_config, activity_index) -- usage may not have accrued yet since the
--       pg_stat counter reset.
--   WAVE 3 -- never auto-drop, manual review only (none in current advisor output).
--
-- Safety checks performed before generating this file:
--   1. Joined pg_index -> pg_constraint for every candidate: 0 candidates back a
--      PRIMARY KEY or UNIQUE constraint (verified via Supabase MCP execute_sql).
--   2. Confirmed indisunique = false AND indisprimary = false for all 113 candidates.
--   3. Used IF EXISTS so re-runs are idempotent.
--
-- Rollback: if a Wave 1 drop causes a regression, recreate the index from the
-- original migration that introduced it (search supabase/migrations/ for the name).

BEGIN;

-- Table: public.destination_activity_bank
DROP INDEX IF EXISTS public."idx_activity_bank_destination_hash";  -- was on destination_activity_bank
DROP INDEX IF EXISTS public."idx_activity_bank_type";  -- was on destination_activity_bank
DROP INDEX IF EXISTS public."idx_activity_bank_budget";  -- was on destination_activity_bank
DROP INDEX IF EXISTS public."idx_activity_bank_time_slot";  -- was on destination_activity_bank
DROP INDEX IF EXISTS public."idx_activity_bank_expires";  -- was on destination_activity_bank
DROP INDEX IF EXISTS public."idx_activity_bank_keywords";  -- was on destination_activity_bank

-- Table: public.destination_activity_cache
DROP INDEX IF EXISTS public."idx_destination_cache_language";  -- was on destination_activity_cache
DROP INDEX IF EXISTS public."idx_destination_cache_lookup_v2";  -- was on destination_activity_cache
DROP INDEX IF EXISTS public."idx_dest_cache_expires";  -- was on destination_activity_cache
DROP INDEX IF EXISTS public."idx_dest_cache_hash";  -- was on destination_activity_cache

-- Table: public.destinations
DROP INDEX IF EXISTS public."idx_destinations_activities";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_country";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_country_trgm";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_enriched";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_enrichment_source";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_google_place";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_lat_lng";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_location";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_price_range";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_search";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_tags";  -- was on destinations
DROP INDEX IF EXISTS public."idx_destinations_transport_options";  -- was on destinations

-- Table: public.distance_cache
DROP INDEX IF EXISTS public."idx_distance_cache_coords";  -- was on distance_cache
DROP INDEX IF EXISTS public."idx_distance_cache_expires";  -- was on distance_cache
DROP INDEX IF EXISTS public."idx_distance_cache_lookup";  -- was on distance_cache
DROP INDEX IF EXISTS public."idx_distance_cache_mode";  -- was on distance_cache

-- Table: public.email_subscribers
DROP INDEX IF EXISTS public."idx_email_subscribers_source";  -- was on email_subscribers

-- Table: public.fcdo_advisory_cache
DROP INDEX IF EXISTS public."idx_fcdo_advisory_cache_expires_at";  -- was on fcdo_advisory_cache

-- Table: public.geocode_cache
DROP INDEX IF EXISTS public."idx_geocode_cache_lookup";  -- was on geocode_cache
DROP INDEX IF EXISTS public."idx_geocode_cache_place_id";  -- was on geocode_cache
DROP INDEX IF EXISTS public."idx_geocode_cache_hash_expires";  -- was on geocode_cache

-- Table: public.google_places_cache
DROP INDEX IF EXISTS public."idx_google_cache_expires";  -- was on google_places_cache
DROP INDEX IF EXISTS public."idx_google_cache_request_hash";  -- was on google_places_cache
DROP INDEX IF EXISTS public."idx_google_cache_type";  -- was on google_places_cache
DROP INDEX IF EXISTS public."idx_places_cache_lookup";  -- was on google_places_cache

-- Table: public.tester_codes
DROP INDEX IF EXISTS public."idx_tester_codes_created_by";  -- was on tester_codes
DROP INDEX IF EXISTS public."idx_tester_codes_active";  -- was on tester_codes
DROP INDEX IF EXISTS public."idx_tester_codes_code";  -- was on tester_codes

COMMIT;
