-- Performance Indexes for Common Query Patterns
-- Applied via Supabase MCP on 2025-12-26

-- 1. Activity Timelines - Queried by trip_id + user_id + day_number
CREATE INDEX IF NOT EXISTS idx_activity_timelines_trip_user_day
ON activity_timelines (trip_id, user_id, day_number);

-- 2. Trip Checklists - Queried by trip_id + user_id, sorted by sort_order
CREATE INDEX IF NOT EXISTS idx_trip_checklists_trip_user_order
ON trip_checklists (trip_id, user_id, sort_order);

-- 3. Google Places Cache - Index for lookups
CREATE INDEX IF NOT EXISTS idx_places_cache_lookup
ON google_places_cache (place_id, cache_type, expires_at);

-- 4. Geocode Cache - Index for address_hash lookups
CREATE INDEX IF NOT EXISTS idx_geocode_cache_hash_expires
ON geocode_cache (address_hash, expires_at);

-- 5. Trip Collaborators - Access check queries
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_trip_user
ON trip_collaborators (trip_id, user_id);

-- 6. Trip Invites - Token validation
CREATE INDEX IF NOT EXISTS idx_trip_invites_token_active
ON trip_invites (token, is_active);

-- 7. Trips - User trip listings by status
CREATE INDEX IF NOT EXISTS idx_trips_user_status
ON trips (user_id, status);

-- 8. API Request Logs - Cost monitoring queries
CREATE INDEX IF NOT EXISTS idx_api_logs_name_timestamp
ON api_request_logs (api_name, timestamp DESC);

-- Estimated impact: 30-70% faster queries on these patterns
