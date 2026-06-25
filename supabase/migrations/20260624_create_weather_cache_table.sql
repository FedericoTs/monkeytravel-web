-- Dedicated cache for historical weather (Open-Meteo). Previously the weather
-- route tried to reuse geocode_cache with columns (address/coordinates/metadata)
-- that DO NOT EXIST on that table, so every read/write threw and was swallowed
-- => the cache was 100% dead. This gives weather its own correctly-shaped table.
-- Service-role only (RLS enabled, no anon policies): written exclusively by the
-- server-side /api/weather route via the admin client.
CREATE TABLE IF NOT EXISTS public.weather_cache (
  cache_key        text PRIMARY KEY,
  weather          jsonb NOT NULL,
  request_metadata jsonb,
  cached_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  hit_count        integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_cache_expires_at
  ON public.weather_cache (expires_at);

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.weather_cache IS
  'Historical weather cache (Open-Meteo), keyed by md5(rounded lat,lng:startDate:endDate). Service-role only; written by /api/weather. Replaces the dead geocode_cache reuse.';
