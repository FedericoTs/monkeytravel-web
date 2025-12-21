-- MCP Itineraries: Temporary storage for ChatGPT-generated trips
-- These are imported when users click "Save to MonkeyTravel" from the widget
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS mcp_itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_id TEXT UNIQUE NOT NULL, -- The reference ID passed in URL (tripId from MCP)
  destination TEXT NOT NULL,
  days INTEGER NOT NULL,
  travel_style TEXT,
  interests TEXT[],
  budget TEXT,
  itinerary JSONB NOT NULL, -- Full itinerary data (days with activities)
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'), -- Auto-expire after 7 days
  claimed_by UUID REFERENCES auth.users(id), -- Set when a user imports it
  claimed_at TIMESTAMPTZ
);

-- Index for fast lookup by ref_id
CREATE INDEX IF NOT EXISTS idx_mcp_itineraries_ref_id ON mcp_itineraries(ref_id);

-- Index for cleanup of expired itineraries
CREATE INDEX IF NOT EXISTS idx_mcp_itineraries_expires_at ON mcp_itineraries(expires_at);

-- RLS policies
ALTER TABLE mcp_itineraries ENABLE ROW LEVEL SECURITY;

-- Anyone can read unclaimed itineraries (for the import page)
CREATE POLICY "Public can read unclaimed itineraries"
  ON mcp_itineraries FOR SELECT
  USING (claimed_by IS NULL);

-- Authenticated users can claim/update their own itineraries
CREATE POLICY "Users can claim itineraries"
  ON mcp_itineraries FOR UPDATE
  USING (auth.uid() IS NOT NULL AND claimed_by IS NULL)
  WITH CHECK (claimed_by = auth.uid());

-- Service role can insert (from MCP API)
-- Note: The MCP API uses service role key to insert

COMMENT ON TABLE mcp_itineraries IS 'Temporary storage for ChatGPT MCP-generated itineraries. Auto-expires after 7 days.';
COMMENT ON COLUMN mcp_itineraries.ref_id IS 'UUID passed in the save URL from ChatGPT widget';
COMMENT ON COLUMN mcp_itineraries.claimed_by IS 'User who imported this itinerary into their account';
