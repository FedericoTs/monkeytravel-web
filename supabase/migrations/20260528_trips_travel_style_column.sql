-- Tier 1.1 from docs/MIGRATION_PLAN.md.
--
-- Promotes travel_style from trip_meta JSONB to a real column on trips.
-- Backpacker Mode (b9f50cb) writes this into trip_meta today; the new
-- column lets us:
--   - Filter /explore by travel_style with an indexed query
--   - Render a Backpacker chip on the trip card without parsing JSONB
--   - Eventually power RLS / SECURITY DEFINER policies that key on style
--
-- Backfill is idempotent — copies any existing trip_meta.travel_style
-- values into the new column. Trips without the field stay at the
-- default 'classic'.
--
-- Applied to prod 2026-05-28 via Supabase MCP.

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS travel_style TEXT
    CHECK (travel_style IN ('classic', 'backpacker'))
    DEFAULT 'classic';

-- Backfill from the JSONB column.
UPDATE public.trips
SET travel_style = trip_meta->>'travel_style'
WHERE trip_meta->>'travel_style' IN ('classic', 'backpacker')
  AND travel_style IS DISTINCT FROM (trip_meta->>'travel_style');

-- Partial index — most trips will be 'classic'; only backpacker rows
-- are worth indexing for the rare /explore filter.
CREATE INDEX IF NOT EXISTS idx_trips_travel_style
  ON public.trips(travel_style)
  WHERE travel_style <> 'classic';

COMMENT ON COLUMN public.trips.travel_style IS
  'Travel-style preset from the wizard (classic | backpacker). Default classic so existing rows backfill cleanly. Mirror of trip_meta->>travel_style — both written by persistTrip during the transition; trip_meta version can be dropped in a later pass.';
