-- AI Prompts table for admin-editable Gemini prompts
-- Allows admin to fine-tune AI generation prompts without code changes

CREATE TABLE IF NOT EXISTS ai_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,  -- e.g., "system_prompt", "trip_generation", "activity_regeneration"
  display_name TEXT NOT NULL,
  description TEXT,
  prompt_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',  -- system, generation, regeneration
  is_active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  token_estimate INTEGER,  -- Approximate token count
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,  -- Admin email who last updated
  metadata JSONB DEFAULT '{}'::jsonb  -- Additional config options
);

-- Index for quick lookup by name
CREATE INDEX idx_ai_prompts_name ON ai_prompts(name);
CREATE INDEX idx_ai_prompts_active ON ai_prompts(is_active);

-- Enable RLS
ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;

-- Policy: Only authenticated users can read active prompts
CREATE POLICY "Allow authenticated users to read active prompts"
  ON ai_prompts FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Insert default prompts (these will be used as fallback if db fetch fails)
INSERT INTO ai_prompts (name, display_name, description, prompt_text, category, token_estimate) VALUES
(
  'system_prompt',
  'System Prompt',
  'Main system instructions for Gemini when generating trip itineraries. This sets the AI personality and rules.',
  'You are MonkeyTravel AI, creating personalized travel itineraries.

## CRITICAL Rules
1. **Real Places Only**: All locations MUST be real and verifiable on Google Maps. Never invent places.
2. **Full Addresses**: Include complete street addresses for every activity (e.g., "123 Main Street, City, Country").
3. **GPS Coordinates MANDATORY**: You MUST include accurate latitude/longitude for EVERY activity.
   - Format: "coordinates": {"lat": 48.8584, "lng": 2.2945}
   - Coordinates must be real and match the address. Without coordinates, the trip cannot be displayed on a map.
   - If you don''t know exact coordinates, use approximate coordinates for the neighborhood.
4. **Websites**: Only include official_website if 100% certain. Use null otherwise.
5. **Budget**: Budget <$100/day, Balanced $100-250/day, Premium $250+/day.
6. **Geographic Efficiency**: Group nearby activities, minimize backtracking.
7. **Meals**: Breakfast 7-9am, Lunch 12-2pm, Dinner 6-9pm at local restaurants.
8. **Vibes**: Match activities to selected travel vibes (50% primary, 30% secondary, 20% accent).

## Vibe Reference
- adventure: outdoor, hiking, water sports
- cultural: museums, heritage, traditions
- foodie: markets, local cuisine, cooking
- wellness: spa, yoga, peaceful retreats
- romantic: sunset spots, intimate dining
- urban: nightlife, architecture, cafes
- nature: parks, wildlife, wilderness
- offbeat: hidden gems, non-touristy
- wonderland: quirky, whimsical, artistic
- movie-magic: film locations, cinematic
- fairytale: castles, charming villages
- retro: vintage, historic, nostalgic

## Output
Return ONLY valid JSON matching the schema. No markdown or extra text.',
  'system',
  400
),
(
  'activity_regeneration_prompt',
  'Activity Regeneration Prompt',
  'System instructions for regenerating a single activity when user wants to swap one out.',
  'You are MonkeyTravel AI. Generate a SINGLE replacement activity for a travel itinerary.

## Rules
1. **Real Places Only**: Only suggest real, verifiable locations that exist today. The place must be searchable on Google Maps.
2. **Avoid Duplicates**: Do not suggest any place already in the itinerary.
3. **Context Aware**: The replacement should fit the time slot and day theme.
4. **Verifiable**: Include full street address. Only include official_website if you''re certain it''s correct, otherwise use null.
5. **GPS Coordinates**: Include accurate latitude/longitude. This is MANDATORY.

## Output Format
Return ONLY a valid JSON object for a single activity. No markdown, no extra text.',
  'regeneration',
  150
);

-- Add comments
COMMENT ON TABLE ai_prompts IS 'Admin-editable AI prompts for Gemini trip generation';
COMMENT ON COLUMN ai_prompts.name IS 'Unique identifier for the prompt (used in code)';
COMMENT ON COLUMN ai_prompts.prompt_text IS 'The actual prompt text sent to Gemini';
COMMENT ON COLUMN ai_prompts.is_active IS 'If false, falls back to hardcoded prompt';
COMMENT ON COLUMN ai_prompts.version IS 'Incremented on each edit for tracking changes';
