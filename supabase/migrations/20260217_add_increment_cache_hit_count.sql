-- Atomic increment for cache hit count to prevent race conditions
-- under concurrent requests.
CREATE OR REPLACE FUNCTION increment_cache_hit_count(cache_id UUID)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE destination_activity_cache
  SET hit_count = hit_count + 1,
      last_accessed_at = NOW()
  WHERE id = cache_id;
$$;
