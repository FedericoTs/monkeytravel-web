-- Performance Indexes for Common Query Patterns
-- Run this migration via Supabase dashboard or CLI

-- 1. Activity Timelines - Queried by trip_id + user_id + day_number
CREATE INDEX IF NOT EXISTS idx_activity_timelines_trip_user_day
ON activity_timelines (trip_id, user_id, day_number);

-- 2. Trip Checklists - Queried by trip_id + user_id, sorted by sort_order
CREATE INDEX IF NOT EXISTS idx_trip_checklists_trip_user_order
ON trip_checklists (trip_id, user_id, sort_order);

-- 3. Google Places Cache - Partial index for active lookups only
CREATE INDEX IF NOT EXISTS idx_places_cache_lookup
ON google_places_cache (place_id, cache_type)
WHERE expires_at > NOW();

-- 4. Geocode Cache - Partial index for address lookups
CREATE INDEX IF NOT EXISTS idx_geocode_cache_address_expires
ON geocode_cache (address)
WHERE expires_at > NOW();

-- 5. Trip Collaborators - Access check queries
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_trip_user
ON trip_collaborators (trip_id, user_id);

-- 6. Trip Invites - Token validation
CREATE INDEX IF NOT EXISTS idx_trip_invites_token_pending
ON trip_invites (token)
WHERE status = 'pending';

-- 7. Trips - User trip listings with soft delete
CREATE INDEX IF NOT EXISTS idx_trips_user_status
ON trips (user_id, status)
WHERE deleted_at IS NULL;

-- 8. API Request Logs - Cost monitoring queries
CREATE INDEX IF NOT EXISTS idx_api_logs_provider_date
ON api_request_logs (provider, created_at DESC);

-- 9. User Bananas Balance - User lookups
CREATE INDEX IF NOT EXISTS idx_user_bananas_user
ON user_bananas_balance (user_id);

-- Estimated impact: 30-70% faster queries on these patterns
