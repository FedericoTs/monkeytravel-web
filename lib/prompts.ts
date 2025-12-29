import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client for prompts
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// In-memory cache for prompts (refreshes every 5 minutes)
const promptCache: Map<string, { text: string; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Default prompts (fallback if database is unavailable)
export const DEFAULT_PROMPTS = {
  trip_generation_system: `You are MonkeyTravel AI, creating personalized travel itineraries.

## CRITICAL Rules
1. **Real Places Only**: All locations MUST be real and verifiable on Google Maps. Never invent places.
2. **Full Addresses**: Include complete street addresses for every activity (e.g., "123 Main Street, City, Country").
3. **GPS Coordinates MANDATORY**: You MUST include PRECISE latitude/longitude for EVERY activity.
   - Format: "coordinates": {"lat": 48.858370, "lng": 2.294481} (6 decimal places for accuracy)
   - Coordinates must be EXACT and match the specific location. Without precise coordinates, pins appear in wrong locations on the map.
   - Use the actual building/entrance coordinates, NOT approximate neighborhood or city center values.
4. **Official Websites**: STRONGLY ENCOURAGED for major attractions, museums, restaurants, and hotels. Include the verified official website URL (e.g., "https://www.louvre.fr", "https://www.eiffeltower.paris"). Use null only for small local businesses or street vendors where no website exists. Well-known places almost always have websites - include them!
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
Return ONLY valid JSON matching the schema. No markdown or extra text.`,

  activity_regeneration: `You are MonkeyTravel AI. Generate a SINGLE replacement activity for a travel itinerary.

## Rules
1. **Real Places Only**: Only suggest real, verifiable locations that exist today. The place must be searchable on Google Maps.
2. **Avoid Duplicates**: Do not suggest any place already in the itinerary.
3. **Context Aware**: The replacement should fit the time slot and day theme.
4. **Verifiable**: Include full street address. Include official_website for museums, attractions, restaurants, and hotels - most well-known places have websites!
5. **GPS Coordinates**: Include accurate latitude/longitude. This is MANDATORY.

## Output Format
Return ONLY a valid JSON object for a single activity. No markdown, no extra text.`,

  continue_generation: `You are MonkeyTravel AI, continuing a travel itinerary.

## CRITICAL Rules
1. **Continuity**: These days follow from an existing itinerary. Maintain style consistency.
2. **Real Places Only**: All locations MUST be real and verifiable on Google Maps.
3. **Full Addresses**: Include complete street addresses for every activity.
4. **GPS Coordinates**: Include accurate latitude/longitude for EVERY activity. MANDATORY.
5. **No Repetition**: Do not repeat any activities from the previous days.
6. **Geographic Flow**: Start each day from a logical location given the previous day.

## Output
Return ONLY a valid JSON array of days. No markdown or extra text.`,
};

export type PromptName = keyof typeof DEFAULT_PROMPTS;

/**
 * Fetch a prompt from the database with caching
 * Falls back to hardcoded default if database is unavailable
 */
export async function getPrompt(name: PromptName): Promise<string> {
  // Check cache first
  const cached = promptCache.get(name);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.text;
  }

  try {
    const { data, error } = await supabase
      .from("ai_prompts")
      .select("prompt_text, is_active")
      .eq("name", name)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      // Use default if not found or error
      const defaultPrompt = DEFAULT_PROMPTS[name];
      promptCache.set(name, { text: defaultPrompt, timestamp: Date.now() });
      return defaultPrompt;
    }

    // Cache and return database prompt
    promptCache.set(name, { text: data.prompt_text, timestamp: Date.now() });
    return data.prompt_text;
  } catch {
    // Fallback to default on any error
    return DEFAULT_PROMPTS[name];
  }
}

/**
 * Clear the prompt cache (useful after admin edits)
 */
export function clearPromptCache(): void {
  promptCache.clear();
}

/**
 * Preload all prompts into cache
 */
export async function preloadPrompts(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("ai_prompts")
      .select("name, prompt_text")
      .eq("is_active", true);

    if (!error && data) {
      for (const prompt of data) {
        if (prompt.name in DEFAULT_PROMPTS) {
          promptCache.set(prompt.name, {
            text: prompt.prompt_text,
            timestamp: Date.now(),
          });
        }
      }
    }
  } catch {
    // Silently fail - will use defaults
  }
}
