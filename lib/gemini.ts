import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeneratedItinerary, TripCreationParams, Activity, ItineraryDay, UserProfilePreferences } from "@/types";
import { generateActivityId } from "./utils/activity-id";
import { getPrompt, DEFAULT_PROMPTS } from "./prompts";
import { captureLLMGeneration, type GeminiUsageMetadata } from "./posthog/llm-analytics";
import { getModelForPurpose } from "./ai/model-router";
import {
  withDeduplication,
  getItineraryDedupKey,
  getActivityDedupKey,
  getMoreDaysDedupKey,
  getDayDedupKey,
} from "./gemini-dedup";

// Threshold for incremental generation (days)
// NOTE: Incremental generation is disabled (threshold set to 99) because:
// 1. The frontend never implemented the handler for loading remaining days
// 2. Users were only getting 3 days for 7+ day trips
// 3. Full generation with increased token limit is more reliable
export const INCREMENTAL_GENERATION_THRESHOLD = 99; // Effectively disabled
export const INITIAL_DAYS_TO_GENERATE = 14; // Max trip length

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Per-attempt timeout for AI requests.
//
// 2026-05-31 P1 FIX: was 120_000ms (120s). With MAX_RETRIES=2 that would
// IMPLY a worst-case of 360s — but Vercel's app/api/ai/generate route
// caps the whole serverless invocation at maxDuration=120 (vercel.json).
// In practice: attempt 1 burned the entire 120s budget, retries never
// fired, users waited 120s for a 500. Observed prod (last 24h):
// 21% failure rate, P95 latency 134s on failures, P95 25s on successes.
//
// New budget: 30s × (1 + MAX_RETRIES=2 attempts) + 3s inter-retry waits
// = ~93s worst case, which fits cleanly under the 120s Vercel maxDuration
// AND gives real retries the chance to run when the first attempt times
// out. The 30s per-attempt covers the P95 of successful calls (25s) plus
// 5s headroom — anything slower than that is almost certainly stuck.
const AI_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Race a promise against a timeout. Throws if the timeout expires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Log Gemini response usage metadata for cache monitoring.
 * Tracks implicit caching stats to verify cost savings, and emits a
 * Sentry warning when the rolling cache-hit rate drops below threshold —
 * catches silent prompt-cache regressions early (often caused by adding
 * a non-cacheable prefix like a timestamp at the start of the prompt).
 */
const CACHE_HIT_RATE_WINDOW = 50; // last N calls
const CACHE_HIT_RATE_ALERT_THRESHOLD = 15; // %; below this we emit a warning
const CACHE_HIT_RATE_MIN_SAMPLES = 20; // don't alert until we have a real signal
const CACHE_HIT_RATE_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 alert/hour max
let cacheHitRolling: number[] = []; // % per call (0-100)
let lastCacheAlertAt = 0;

/**
 * Exported so every API route that calls Gemini can wire the same
 * rolling cache-hit metric, instead of each route reinventing its own
 * (or — as was the case before 2026-05-31 — silently skipping it and
 * letting prompt-cache regressions burn money invisibly).
 *
 * Call this AFTER any `model.generateContent(...)` /
 * `model.generateContentStream(...)` and pass `response.usageMetadata`
 * along with a stable route label (e.g. "concierge", "assistant.new_activity").
 */
export function logCacheMetrics(
  endpoint: string,
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  }
) {
  if (!usageMetadata) return;

  const {
    promptTokenCount = 0,
    candidatesTokenCount = 0,
    cachedContentTokenCount = 0,
  } = usageMetadata;

  const cacheHitRatePct =
    promptTokenCount > 0 ? (cachedContentTokenCount / promptTokenCount) * 100 : 0;

  console.log(
    `[Gemini Cache] ${endpoint}: ` +
      `prompt=${promptTokenCount}, output=${candidatesTokenCount}, ` +
      `cached=${cachedContentTokenCount} (${cacheHitRatePct.toFixed(1)}% cache hit)`
  );

  // Calculate cost savings (cached tokens are 75% cheaper)
  if (cachedContentTokenCount > 0) {
    const regularCost = cachedContentTokenCount * 0.00001; // $0.01 per 1K tokens
    const cachedCost = cachedContentTokenCount * 0.0000025; // $0.0025 per 1K cached tokens
    const savings = regularCost - cachedCost;
    console.log(`[Gemini Cache] Savings: $${savings.toFixed(6)} from cached tokens`);
  }

  // Rolling cache-hit-rate alerting
  if (promptTokenCount > 0) {
    cacheHitRolling.push(cacheHitRatePct);
    if (cacheHitRolling.length > CACHE_HIT_RATE_WINDOW) {
      cacheHitRolling = cacheHitRolling.slice(-CACHE_HIT_RATE_WINDOW);
    }
    if (cacheHitRolling.length >= CACHE_HIT_RATE_MIN_SAMPLES) {
      const avg =
        cacheHitRolling.reduce((a, b) => a + b, 0) / cacheHitRolling.length;
      const now = Date.now();
      if (
        avg < CACHE_HIT_RATE_ALERT_THRESHOLD &&
        now - lastCacheAlertAt > CACHE_HIT_RATE_ALERT_COOLDOWN_MS
      ) {
        lastCacheAlertAt = now;
        const msg =
          `[Gemini Cache] ⚠ Rolling cache-hit rate over the last ` +
          `${cacheHitRolling.length} calls is ${avg.toFixed(1)}% ` +
          `(threshold: ${CACHE_HIT_RATE_ALERT_THRESHOLD}%). Likely cause: ` +
          `a non-cacheable prefix at the start of the prompt (timestamp, ` +
          `request ID, locale-dynamic header). Audit lib/prompts.ts and ` +
          `move dynamic content to the END of the prompt.`;
        console.warn(msg);
        // Best-effort Sentry capture — wrapped so a missing/failed Sentry
        // never breaks the Gemini call path. Imported lazily so the
        // dependency stays optional.
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.captureMessage?.(msg, "warning");
          })
          .catch(() => {
            /* Sentry not available — console.warn above is the fallback */
          });
      }
    }
  }
}

// Model configurations
// NOTE: kept for backward compat with callers that still import MODELS
// (e.g. lib/email-parse/extract.ts, lib/gemini-vision.ts). New code should
// route through `getModelForPurpose(...)` in `lib/ai/model-router.ts` so
// the routing matrix + env override (GEMINI_MODEL_OVERRIDE) live in one
// place.
// See: https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/
export const MODELS = {
  fast: "gemini-2.5-flash-lite",      // Cheapest with implicit caching ($0.10/1M → $0.025 with cache)
  thinking: "gemini-2.5-pro",          // Best for complex reasoning
  premium: "gemini-2.5-flash",         // Best price/performance ratio
} as const;

// System prompt for trip generation - now loaded from database via getPrompt()
// See lib/prompts.ts for default values and database integration

/**
 * Build profile preferences section for the prompt
 * Includes dietary restrictions, travel styles, and accessibility needs
 */
function buildProfilePreferencesSection(profilePreferences?: UserProfilePreferences): string {
  if (!profilePreferences) return "";

  const sections: string[] = [];

  // Dietary preferences - CRITICAL for food recommendations
  if (profilePreferences.dietaryPreferences && profilePreferences.dietaryPreferences.length > 0) {
    const dietLabels: Record<string, string> = {
      "vegetarian": "Vegetarian (no meat)",
      "vegan": "Vegan (no animal products)",
      "halal": "Halal (Islamic dietary laws)",
      "kosher": "Kosher (Jewish dietary laws)",
      "gluten-free": "Gluten-Free",
      "no-restrictions": "No dietary restrictions",
    };
    const formatted = profilePreferences.dietaryPreferences
      .filter(d => d !== "no-restrictions")
      .map(d => dietLabels[d] || d)
      .join(", ");
    if (formatted) {
      sections.push(`- Dietary Requirements: ${formatted}
  IMPORTANT: ALL restaurant suggestions MUST accommodate these dietary needs. Prioritize restaurants known for these options.`);
    }
  }

  // Accessibility needs - affects venue selection
  if (profilePreferences.accessibilityNeeds && profilePreferences.accessibilityNeeds.length > 0) {
    const accessLabels: Record<string, string> = {
      "wheelchair": "Wheelchair accessible",
      "limited-mobility": "Limited mobility (avoid stairs, long walks)",
      "visual": "Visual impairment accommodations",
      "hearing": "Hearing impairment accommodations",
      "sensory": "Sensory-friendly environments",
    };
    const formatted = profilePreferences.accessibilityNeeds
      .map(a => accessLabels[a] || a)
      .join(", ");
    sections.push(`- Accessibility Needs: ${formatted}
  IMPORTANT: All suggested venues MUST be accessible. Avoid locations with stairs, uneven terrain, or limited accessibility.`);
  }

  // Travel styles - influences overall itinerary style
  if (profilePreferences.travelStyles && profilePreferences.travelStyles.length > 0) {
    const styleLabels: Record<string, string> = {
      "adventure": "Adventure-seeker",
      "relaxation": "Relaxation-focused",
      "cultural": "Cultural immersion",
      "foodie": "Food enthusiast",
      "romantic": "Romantic experiences",
      "budget": "Budget-conscious",
      "luxury": "Luxury experiences",
      "solo": "Solo traveler",
      "family": "Family-friendly",
    };
    const formatted = profilePreferences.travelStyles
      .map(s => styleLabels[s] || s)
      .join(", ");
    sections.push(`- Travel Style Preferences: ${formatted}`);
  }

  if (sections.length === 0) return "";

  return `
## Profile Preferences (from user profile)
${sections.join("\n")}
`;
}

/**
 * Build scheduling preferences section for the prompt
 * Uses the user's quiet hours settings to inform activity timing
 * Quiet hours are inverted: if user rests 22:00-08:00, they're active 08:00-22:00
 */
function buildSchedulingPreferencesSection(profilePreferences?: UserProfilePreferences): string {
  if (!profilePreferences) return "";

  const { activeHoursStart, activeHoursEnd } = profilePreferences;

  // Only include if both values are set and reasonable
  if (activeHoursStart === undefined || activeHoursEnd === undefined) return "";
  if (!Number.isInteger(activeHoursStart) || !Number.isInteger(activeHoursEnd)) return "";
  if (activeHoursStart < 0 || activeHoursStart > 23) return "";
  if (activeHoursEnd < 0 || activeHoursEnd > 23) return "";
  // Ensure end is after start with at least a 4-hour window
  if (activeHoursEnd <= activeHoursStart) return "";
  if (activeHoursEnd - activeHoursStart < 4) return "";

  // Format hours nicely (e.g., 8 -> "8:00 AM", 22 -> "10:00 PM")
  const formatHour = (h: number) => {
    const hour12 = h % 12 || 12;
    const ampm = h < 12 ? "AM" : "PM";
    return `${hour12}:00 ${ampm}`;
  };

  const startFormatted = formatHour(activeHoursStart);
  const endFormatted = formatHour(activeHoursEnd);

  return `
## Activity Scheduling Preferences
- User prefers activities between ${startFormatted} and ${endFormatted}
- IMPORTANT: Schedule the first activity of each day no earlier than ${startFormatted}
- IMPORTANT: Ensure all activities end by ${endFormatted} (avoid late-night activities)
- For restaurants: prefer lunch around 12:00-14:00, dinner no later than ${activeHoursEnd - 2}:00
- Allow adequate time for transit between activities
`;
}

interface BuildPromptOptions {
  maxDays?: number; // Limit days to generate (for incremental generation)
  isPartial?: boolean; // Indicates this is a partial generation
  language?: "en" | "es" | "it"; // Language for AI response
}

/**
 * Get language instruction for AI response
 * Tells Gemini to generate content in the user's preferred language
 */
function getLanguageInstruction(language?: "en" | "es" | "it"): string {
  if (!language || language === "en") return "";

  const instructions: Record<"es" | "it", string> = {
    es: `
## IDIOMA OBLIGATORIO
DEBES responder COMPLETAMENTE en espanol.
- Nombres de actividades: usa el nombre local con traduccion si es util
- Descripciones: escritas naturalmente en espanol
- Consejos (tips): en espanol
- Resumen del viaje: en espanol
- Formato de hora: 24h (ej: 14:00 en lugar de 2:00 PM)
- IMPORTANTE: Mantén la estructura JSON exacta, solo cambia el contenido de texto a espanol`,
    it: `
## LINGUA OBBLIGATORIA
DEVI rispondere COMPLETAMENTE in italiano.
- Nomi delle attivita: usa il nome locale con traduzione se utile
- Descrizioni: scritte naturalmente in italiano
- Consigli (tips): in italiano
- Riepilogo del viaggio: in italiano
- Formato dell'ora: 24h (es: 14:00 invece di 2:00 PM)
- IMPORTANTE: Mantieni la struttura JSON esatta, cambia solo il contenuto testuale in italiano`,
  };

  return instructions[language] + "\n\n";
}

/**
 * Known destination coordinates for fallback when Gemini doesn't provide coordinates
 * These are approximate city center coordinates
 */
const DESTINATION_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "paris": { lat: 48.8566, lng: 2.3522 },
  "rome": { lat: 41.9028, lng: 12.4964 },
  "tokyo": { lat: 35.6762, lng: 139.6503 },
  "london": { lat: 51.5074, lng: -0.1278 },
  "new york": { lat: 40.7128, lng: -74.0060 },
  "barcelona": { lat: 41.3851, lng: 2.1734 },
  "amsterdam": { lat: 52.3676, lng: 4.9041 },
  "berlin": { lat: 52.5200, lng: 13.4050 },
  "lisbon": { lat: 38.7223, lng: -9.1393 },
  "prague": { lat: 50.0755, lng: 14.4378 },
  "vienna": { lat: 48.2082, lng: 16.3738 },
  "budapest": { lat: 47.4979, lng: 19.0402 },
  "sydney": { lat: -33.8688, lng: 151.2093 },
  "dubai": { lat: 25.2048, lng: 55.2708 },
  "singapore": { lat: 1.3521, lng: 103.8198 },
  "bangkok": { lat: 13.7563, lng: 100.5018 },
  "bali": { lat: -8.3405, lng: 115.0920 },
  "milan": { lat: 45.4642, lng: 9.1900 },
  "florence": { lat: 43.7696, lng: 11.2558 },
  "venice": { lat: 45.4408, lng: 12.3155 },
  "athens": { lat: 37.9838, lng: 23.7275 },
  "madrid": { lat: 40.4168, lng: -3.7038 },
  "seville": { lat: 37.3891, lng: -5.9845 },
  "porto": { lat: 41.1579, lng: -8.6291 },
  "marrakech": { lat: 31.6295, lng: -7.9811 },
  "cairo": { lat: 30.0444, lng: 31.2357 },
  "cape town": { lat: -33.9249, lng: 18.4241 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  "miami": { lat: 25.7617, lng: -80.1918 },
  "chicago": { lat: 41.8781, lng: -87.6298 },
  "toronto": { lat: 43.6532, lng: -79.3832 },
  "mexico city": { lat: 19.4326, lng: -99.1332 },
  "buenos aires": { lat: -34.6037, lng: -58.3816 },
  "rio de janeiro": { lat: -22.9068, lng: -43.1729 },
};

/**
 * Validate and fix coordinates for all activities in the itinerary
 * If coordinates are missing, uses destination-based fallback with small random offset
 */
function validateAndFixCoordinates(days: ItineraryDay[], destination: string): ItineraryDay[] {
  // Try to find destination coordinates
  const destLower = destination.toLowerCase();
  let destCoords = DESTINATION_COORDINATES[destLower];

  // Try partial match (e.g., "Paris, France" -> "paris")
  if (!destCoords) {
    const firstWord = destLower.split(/[,\s]+/)[0];
    destCoords = DESTINATION_COORDINATES[firstWord];
  }

  // Default fallback (center of Europe if nothing matches)
  if (!destCoords) {
    destCoords = { lat: 48.0, lng: 10.0 };
    console.warn(`[Gemini] No known coordinates for destination: ${destination}, using default`);
  }

  let missingCount = 0;
  let fixedCount = 0;

  const fixedDays = days.map(day => ({
    ...day,
    activities: day.activities.map((activity, idx) => {
      // Check if coordinates are valid
      const hasValidCoords =
        activity.coordinates &&
        typeof activity.coordinates.lat === "number" &&
        typeof activity.coordinates.lng === "number" &&
        !isNaN(activity.coordinates.lat) &&
        !isNaN(activity.coordinates.lng) &&
        activity.coordinates.lat >= -90 &&
        activity.coordinates.lat <= 90 &&
        activity.coordinates.lng >= -180 &&
        activity.coordinates.lng <= 180;

      if (hasValidCoords) {
        return activity;
      }

      // Coordinates are missing or invalid - apply fallback
      missingCount++;

      // Generate a small random offset (within ~1-2km of city center)
      // This spreads out activities on the map rather than stacking them
      const offsetLat = (Math.random() - 0.5) * 0.02 + (idx * 0.003);
      const offsetLng = (Math.random() - 0.5) * 0.02 + (idx * 0.003);

      const fixedActivity = {
        ...activity,
        coordinates: {
          lat: destCoords.lat + offsetLat,
          lng: destCoords.lng + offsetLng,
        },
      };
      fixedCount++;

      return fixedActivity;
    }),
  }));

  if (fixedCount > 0) {
    console.log(`[Gemini] Fixed ${fixedCount} activities with missing coordinates for ${destination}`);
  }

  return fixedDays;
}

function buildUserPrompt(params: TripCreationParams, options?: BuildPromptOptions): string {
  const totalDuration =
    Math.ceil(
      (new Date(params.endDate).getTime() -
        new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

  // For partial generation, only generate up to maxDays
  const duration = options?.maxDays ? Math.min(options.maxDays, totalDuration) : totalDuration;

  // Pre-compute URL-safe destination for booking links
  const destEncoded = encodeURIComponent(params.destination);
  const destSlug = params.destination.split(",")[0].toLowerCase().replace(/\s+/g, "");

  // Build vibe section with weighted influence
  const vibeLabels: Record<string, string> = {
    adventure: "Adventure Seeker - outdoor activities, hiking, adrenaline",
    cultural: "Cultural Explorer - museums, heritage, local traditions",
    foodie: "Foodie Journey - food markets, local cuisine, restaurants",
    wellness: "Wellness Escape - spa, yoga, peaceful retreats",
    romantic: "Romantic Getaway - intimate experiences, sunset views",
    urban: "Urban Discovery - city life, nightlife, architecture",
    nature: "Nature Immersion - wildlife, parks, wilderness",
    offbeat: "Off the Beaten Path - hidden gems, non-touristy spots",
    wonderland: "Wonderland Adventure - quirky, whimsical, surreal spots",
    "movie-magic": "Movie Magic - film locations, cinematic experiences",
    fairytale: "Fairytale Escape - castles, enchanted forests, storybook villages",
    retro: "Retro Time Travel - vintage cafes, historic districts, nostalgia",
  };

  const vibeSection = params.vibes && params.vibes.length > 0
    ? `## Travel Vibes (${params.vibes.length} selected - PRIORITIZE THESE)
${params.vibes.map((v, i) => {
  const influence = i === 0 ? "50% Primary" : i === 1 ? "30% Secondary" : "20% Accent";
  return `- ${influence}: ${vibeLabels[v] || v}`;
}).join("\n")}

IMPORTANT: Blend these vibes throughout the itinerary. For fantasy vibes (wonderland, movie-magic, fairytale, retro), seek out unusual, photogenic, and story-worthy locations that match that aesthetic.
`
    : "";

  // Backpacker Mode — added 2026-05-28.
  //
  // When the traveller picked "Backpacker mode" in the wizard, inject a
  // strong directive so Gemini optimises the entire itinerary for the
  // budget / multi-city / social demographic — not just the budget tier.
  // This is the strategic wedge for the Hostelworld partnership: the
  // generated trips have to *look* like backpacker plans (hostels,
  // walking tours, public transit, social food spots) for the partner
  // demo to land.
  const travelStyleSection = params.travelStyle === "backpacker"
    ? `## Travel Style: BACKPACKER MODE
This traveller is a budget-conscious backpacker. Optimise the itinerary accordingly:

- **Accommodation**: Recommend hostels and budget guesthouses, not hotels. Mention specific neighbourhoods known for hostel density (e.g. Bairro Alto in Lisbon, Khao San in Bangkok). Avoid luxury or boutique accommodation suggestions.
- **Activities**: Favour free walking tours, public museums on free days, viewpoints, markets, beaches, parks. Skip expensive guided tours and curated experiences unless they're a genuine highlight.
- **Food**: Recommend street food, markets, local cafeterias, hostel-kitchen-friendly grocery options. One "splurge" meal at most, ideally local and not touristy.
- **Transit**: Default to walking, public transit, intercity buses (FlixBus, BlaBlaCar). Avoid taxis unless safety / late-night. Mention specific transit cards or passes worth getting.
- **Social**: Include at least one explicitly social-friendly activity per day (pub crawl, walking tour, language exchange, market, hostel-organised event). Backpackers want to meet people.
- **Multi-city friendly**: If the trip is 5+ days, consider whether splitting between 2 cities would serve them better. Mention the transit option if so.
- **Time of day**: Backpackers often arrive late after long bus/train rides; early activities on arrival days should be optional, not core.

The traveller specifically wants the backpacker experience. Do NOT default to mid-range tourist plans.
`
    : "";

  // Build seasonal context section
  const seasonalSection = params.seasonalContext
    ? `## Seasonal Context
- Season: ${params.seasonalContext.season}
- Expected Weather: ${params.seasonalContext.weather}
- Temperature: ${params.seasonalContext.avgTemp.min}°C to ${params.seasonalContext.avgTemp.max}°C
- Crowd Level: ${params.seasonalContext.crowdLevel}
${params.seasonalContext.holidays.length > 0 ? `- Holidays/Events: ${params.seasonalContext.holidays.join(", ")}` : ""}

Consider these seasonal factors when selecting activities and timing. Include seasonal-specific experiences if relevant.
`
    : "";

  // Partial generation note
  const partialNote = options?.isPartial && options.maxDays && options.maxDays < totalDuration
    ? `\n\nNOTE: This is a PARTIAL generation. Only generate days 1-${duration} (of ${totalDuration} total). The remaining days will be generated separately.`
    : "";

  // Language instruction for non-English responses
  const languageSection = getLanguageInstruction(options?.language);

  return `${languageSection}Plan a ${duration}-day trip to ${params.destination}.${partialNote}

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
- Duration: ${duration} days${options?.isPartial ? ` (partial - generating first ${duration} of ${totalDuration})` : ""}
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace}

${travelStyleSection}${vibeSection}${seasonalSection}## Traveler Preferences
- Interests: ${params.interests.length > 0 ? params.interests.join(", ") : "general sightseeing"}
${params.requirements ? `- Special Requirements: ${params.requirements}` : ""}
${buildProfilePreferencesSection(params.profilePreferences)}${buildSchedulingPreferencesSection(params.profilePreferences)}

## Required Output

Generate a complete day-by-day itinerary in JSON format with this exact structure:

{
  "destination": {
    "name": "City Name",
    "country": "Country",
    "description": "Brief 1-2 sentence description",
    "best_for": ["type1", "type2"],
    "weather_note": "Expected weather for travel dates"
  },
  "days": [
    {
      "day_number": 1,
      "date": "YYYY-MM-DD",
      "theme": "Day theme (e.g., Historic Center)",
      "activities": [
        {
          "time_slot": "morning",
          "start_time": "09:00",
          "duration_minutes": 120,
          "name": "Real Place Name",
          "type": "attraction",
          "description": "What to do here",
          "location": "Neighborhood name",
          "address": "Full street address",
          "coordinates": {
            "lat": 48.858370,
            "lng": 2.294481
          },
          "official_website": "https://www.example-museum.com",
          "estimated_cost": {
            "amount": 25,
            "currency": "USD",
            "tier": "moderate"
          },
          "tips": ["One helpful tip"],
          "booking_required": false
        }
      ]
    }
  ],
  "trip_summary": {
    "total_estimated_cost": 450,
    "currency": "USD",
    "highlights": ["Highlight 1", "Highlight 2", "Highlight 3"],
    "packing_suggestions": ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5"]
  },
  "booking_links": {
    "flights": [
      {"provider": "Skyscanner", "url": "https://www.skyscanner.com/transport/flights/nyc/${destSlug}/${params.startDate}", "label": "Search flights on Skyscanner"},
      {"provider": "Google Flights", "url": "https://www.google.com/travel/flights?q=flights+to+${destEncoded}", "label": "Search on Google Flights"}
    ],
    "hotels": [
      {"provider": "Booking.com", "url": "https://www.booking.com/searchresults.html?ss=${destEncoded}&checkin=${params.startDate}&checkout=${params.endDate}", "label": "Find hotels on Booking.com"},
      {"provider": "Airbnb", "url": "https://www.airbnb.com/s/${destEncoded}/homes?checkin=${params.startDate}&checkout=${params.endDate}", "label": "Browse Airbnb stays"}
    ]
  }
}

Rules:
1. Return ONLY valid JSON, no markdown or extra text
2. All dates must be in YYYY-MM-DD format starting from ${params.startDate}
3. Include 3-5 activities per day based on ${params.pace} pace
4. Use REAL place names that exist on Google Maps
5. INCLUDE official_website for major attractions, museums, restaurants, and hotels (they almost always have websites!). Only use null for small local shops/street vendors
6. Activities should flow logically through each day
7. EVERY activity MUST have PRECISE coordinates (lat/lng with 6 decimal places, e.g., 48.858370, 2.294481) - use the EXACT location of each place, not approximate city center. This is critical for accurate map display`;
}

/**
 * Generation options for controlling output
 */
export interface GenerationOptions extends BuildPromptOptions {
  retryCount?: number;
}

/**
 * Partial itinerary result - returned when generating incrementally
 */
export interface PartialItineraryResult {
  itinerary: GeneratedItinerary;
  isPartial: boolean;
  generatedDays: number;
  totalDays: number;
  hasMoreDays: boolean;
}

/**
 * Check if a trip requires incremental generation based on duration
 */
export function shouldUseIncrementalGeneration(startDate: string, endDate: string): boolean {
  const duration = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;
  return duration > INCREMENTAL_GENERATION_THRESHOLD;
}

export async function generateItinerary(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): Promise<GeneratedItinerary> {
  // Generate deduplication key from request parameters
  const dedupKey = getItineraryDedupKey({
    destination: params.destination,
    startDate: params.startDate,
    endDate: params.endDate,
    budgetTier: params.budgetTier,
    pace: params.pace,
    vibes: params.vibes,
    language: options?.language,
  });

  // Wrap with deduplication to prevent duplicate concurrent requests
  return withDeduplication(dedupKey, () =>
    generateItineraryInternal(params, options)
  );
}

/**
 * Internal itinerary generation function (without deduplication wrapper)
 */
async function generateItineraryInternal(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): Promise<GeneratedItinerary> {
  const retryCount = options?.retryCount ?? 0;
  const MAX_RETRIES = 2;
  const startTime = performance.now();

  // Route through model-router so the routing matrix lives in one place.
  // trip-generation → gemini-2.5-pro (full itinerary, quality matters).
  const modelName = getModelForPurpose("trip-generation");

  // maxOutputTokens: lowered from 8192 → 6000 per the 2026-05-31 API
  // audit. ~25% output cost savings on the long tail (Gemini bills for
  // the cap, not the actual emitted tokens, on certain configurations).
  // Median trip is 3-5 days @ ~750 tokens/day = ~3k tokens — well under
  // the new ceiling. The 1% tail of 12-14 day trips that would exceed
  // 6000 tokens will truncate the final day's tips/cost block; the
  // post-process coordinate fixer + JSON.parse failure path will retry
  // with the lower-temperature branch which produces tighter output.
  // 2026-06-01 P0 FIX: disable thinking on gemini-2.5-pro for the
  // trip-generation call. Pro is a thinking model and the legacy
  // @google/generative-ai SDK (0.24.x) doesn't expose thinkingConfig
  // in its TS types — but the underlying REST endpoint accepts it.
  // We pass it through via type-cast.
  //
  // Why this matters: Sentry issue 123983732 (2026-06-01 03:35 UTC)
  // showed 'AI service unavailable' in prod. Direct REST test against
  // 2.5-pro showed 1433 *thoughts* tokens for a 1-CHAR prompt taking
  // 14s. For a real itinerary prompt (1500-3000 input tokens, 6000
  // output cap), default thinking blows past AI_REQUEST_TIMEOUT_MS
  // (30s) — every attempt times out, retries fire, route returns 500
  // after ~93s.
  //
  // thinkingBudget=0 → no extended thinking → response time matches
  // 2.5-flash (~10-25s for a full itinerary). Same model quality for
  // structured JSON output where deep reasoning isn't needed.
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: retryCount > 0 ? 0.7 : 1.0, // Lower temperature on retry
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 6000,
      responseMimeType: "application/json",
      // Cast: legacy SDK types lack `thinkingConfig`; the REST API has
      // accepted it since 2025-Q2. If a future SDK upgrade exposes it
      // natively, drop the cast.
      ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
    },
  });

  // Fetch system prompt from database (with caching and fallback)
  const systemPrompt = await getPrompt("trip_generation_system");

  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I will generate travel itineraries following these rules, returning only valid JSON matching the specified schema.",
          },
        ],
      },
    ],
  });

  // Pass options to buildUserPrompt for partial generation support
  const userPrompt = buildUserPrompt(params, options);

  try {
    const result = await withTimeout(
      chat.sendMessage(userPrompt),
      AI_REQUEST_TIMEOUT_MS,
      "Itinerary generation"
    );
    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("generateItinerary", response.usageMetadata);

    // Try to parse JSON
    try {
      const itinerary = JSON.parse(text) as GeneratedItinerary;

      // Validate required fields exist
      if (!itinerary.destination || !itinerary.days || itinerary.days.length === 0) {
        throw new Error("Invalid itinerary structure");
      }

      // Validate and fix coordinates for all activities
      itinerary.days = validateAndFixCoordinates(itinerary.days, params.destination);

      // Capture LLM analytics (fire and forget)
      captureLLMGeneration({
        distinctId: options?.userId || "anonymous",
        model: modelName,
        endpoint: "generateItinerary",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          duration_days: itinerary.days.length,
          budget_tier: params.budgetTier,
          pace: params.pace,
          vibes: params.vibes,
          retry_count: retryCount,
        },
      }).catch(() => {}); // Ignore analytics errors

      return itinerary;
    } catch (parseError) {
      console.error(
        `JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      // Capture failed attempt analytics
      captureLLMGeneration({
        distinctId: options?.userId || "anonymous",
        model: modelName,
        endpoint: "generateItinerary",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          retry_count: retryCount,
        },
      }).catch(() => {});

      // Retry with lower temperature (bypass deduplication for retries)
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying generation (attempt ${retryCount + 2})...`);
        return generateItineraryInternal(params, { ...options, retryCount: retryCount + 1 });
      }

      throw new Error("Failed to generate valid itinerary after retries");
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    // Handle API errors (rate limits, network issues, etc.)
    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: options?.userId || "anonymous",
      model: modelName,
      endpoint: "generateItinerary",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return generateItineraryInternal(params, { ...options, retryCount: retryCount + 1 });
    }

    // 2026-06-01: surface the underlying error so Sentry sees WHY we
    // failed — previously the wrapper masked the Google response (403
    // key-banned, 429 quota, 503 outage, etc.) making prod debugging
    // impossible. Preserve `cause` so the original stack survives.
    const rootMsg =
      error instanceof Error ? error.message : String(error ?? "unknown");
    const wrapped = new Error(
      `Failed to generate itinerary: AI service unavailable (root: ${rootMsg.slice(0, 200)})`
    );
    if (error instanceof Error) {
      (wrapped as Error & { cause?: unknown }).cause = error;
    }
    throw wrapped;
  }
}

/**
 * Regenerate a single activity within an itinerary
 * Used when a user wants to replace one activity with a different suggestion
 */
export interface RegenerateActivityParams {
  destination: string;
  activityToReplace: Activity;
  dayContext: ItineraryDay;
  budgetTier: "budget" | "balanced" | "premium";
  existingActivityNames: string[];
  preferences?: {
    category?: "attraction" | "restaurant" | "activity" | "transport";
    similarTo?: boolean; // If true, generate something similar
  };
  language?: "en" | "es" | "it";
  /**
   * Trip's travel style — when "backpacker", the replacement is biased
   * toward hostel-friendly / budget / social options. Read from
   * trip_meta.travel_style at the call site. Defaults to "classic".
   * Bug fix 2026-05-28: without this, the assistant would replace a
   * backpacker hostel recommendation with e.g. a boutique hotel.
   */
  travelStyle?: "classic" | "backpacker";
}

// Activity regeneration prompt - now loaded from database via getPrompt()
// See lib/prompts.ts for default values

export async function regenerateSingleActivity(
  params: RegenerateActivityParams & { userId?: string },
  retryCount = 0
): Promise<Activity> {
  // Generate deduplication key - note: only first call gets deduplicated, retries bypass
  if (retryCount === 0) {
    const dedupKey = getActivityDedupKey({
      destination: params.destination,
      activityName: params.activityToReplace.name,
      timeSlot: params.activityToReplace.time_slot,
      dayNumber: params.dayContext.day_number,
      budgetTier: params.budgetTier,
    });

    return withDeduplication(dedupKey, () =>
      regenerateSingleActivityInternal(params, retryCount)
    );
  }

  // Retries bypass deduplication
  return regenerateSingleActivityInternal(params, retryCount);
}

/**
 * Internal activity regeneration function (without deduplication wrapper)
 */
async function regenerateSingleActivityInternal(
  params: RegenerateActivityParams & { userId?: string },
  retryCount = 0
): Promise<Activity> {
  const MAX_RETRIES = 2;
  const startTime = performance.now();
  // activity-regenerate → gemini-2.5-flash-lite (cheapest, single activity).
  const modelName = getModelForPurpose("activity-regenerate");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // 2026-05-31: lowered from 1.2/0.8 → 0.5/0.3 (deterministic utility task).
      // Single-activity regenerate is a utility call — users want the swap to
      // be reproducible enough that two clicks on the same activity surface
      // similar shapes, and prompt-cache hits go up materially as the sampling
      // distribution narrows. Creative variety is still preserved via the
      // exclusion list of existing activity names in the prompt itself.
      temperature: retryCount > 0 ? 0.3 : 0.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const { activityToReplace, dayContext, existingActivityNames, preferences } = params;

  const languageInstruction = getLanguageInstruction(params.language);

  const userPrompt = `${languageInstruction}Generate a replacement activity for a trip to ${params.destination}.

## Current Activity to Replace
- Name: ${activityToReplace.name}
- Type: ${activityToReplace.type}
- Time Slot: ${activityToReplace.time_slot}
- Start Time: ${activityToReplace.start_time}
- Duration: ${activityToReplace.duration_minutes} minutes
- Location: ${activityToReplace.location}

## Day Context
- Day Theme: ${dayContext.theme || "General exploration"}
- Date: ${dayContext.date}
- Other activities this day: ${dayContext.activities.filter(a => a.name !== activityToReplace.name).map(a => a.name).join(", ") || "None"}

## Constraints
- Budget Tier: ${params.budgetTier}
- Time Slot: ${activityToReplace.time_slot}
- Start Time: ${activityToReplace.start_time}
- Duration should be approximately: ${activityToReplace.duration_minutes} minutes
${preferences?.category ? `- Category preference: ${preferences.category}` : ""}
${preferences?.similarTo ? "- Should be similar in type/style to the replaced activity" : "- Should be different/fresh compared to the replaced activity"}
${params.travelStyle === "backpacker" ? `- BACKPACKER TRIP: prefer hostels (not hotels), street food / markets / casual eateries, free walking tours, viewpoints, public transit. Avoid expensive guided tours, taxis, and upscale dining. Favour social spots where solo travellers can meet others.` : ""}

## Do NOT suggest any of these places (already in itinerary):
${existingActivityNames.join(", ")}

## Required JSON Output
{
  "time_slot": "${activityToReplace.time_slot}",
  "start_time": "${activityToReplace.start_time}",
  "duration_minutes": ${activityToReplace.duration_minutes},
  "name": "Real Place Name",
  "type": "attraction|restaurant|activity|transport",
  "description": "What to do here (2-3 sentences)",
  "location": "Neighborhood or area name",
  "address": "Full street address",
  "coordinates": {
    "lat": 48.858370,
    "lng": 2.294481
  },
  "official_website": null,
  "estimated_cost": {
    "amount": 0,
    "currency": "USD",
    "tier": "free|budget|moderate|expensive"
  },
  "tips": ["Tip 1", "Tip 2"],
  "booking_required": false
}

Return ONLY the JSON object, no extra text.`;

  // Fetch regeneration prompt from database (with caching and fallback)
  const regenerateSystemPrompt = await getPrompt("activity_regeneration");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: regenerateSystemPrompt }] },
          { role: "model", parts: [{ text: "Understood. I will generate a single replacement activity as valid JSON." }] },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "Activity regeneration"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("regenerateSingleActivity", response.usageMetadata);

    try {
      const activity = JSON.parse(text) as Activity;

      // Validate required fields
      if (!activity.name || !activity.type || !activity.time_slot) {
        throw new Error("Invalid activity structure");
      }

      // Add unique ID
      activity.id = generateActivityId();

      // Validate coordinates range
      if (
        activity.coordinates &&
        typeof activity.coordinates.lat === "number" &&
        typeof activity.coordinates.lng === "number" &&
        (activity.coordinates.lat < -90 || activity.coordinates.lat > 90 ||
         activity.coordinates.lng < -180 || activity.coordinates.lng > 180 ||
         activity.coordinates.lat === 0 && activity.coordinates.lng === 0)
      ) {
        activity.coordinates = undefined as unknown as typeof activity.coordinates;
      }

      // Capture LLM analytics (fire and forget)
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleActivity",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          replaced_activity: activityToReplace.name,
          new_activity: activity.name,
          budget_tier: params.budgetTier,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return activity;
    } catch (parseError) {
      console.error(
        `Activity regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 300)
      );

      // Capture failed attempt analytics
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleActivity",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          retry_count: retryCount,
        },
      }).catch(() => {});

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying activity regeneration (attempt ${retryCount + 2})...`);
        return regenerateSingleActivityInternal(params, retryCount + 1);
      }

      throw new Error("Failed to regenerate activity after retries");
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error during activity regeneration:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "regenerateSingleActivity",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return regenerateSingleActivityInternal(params, retryCount + 1);
    }

    throw new Error("Failed to regenerate activity: AI service unavailable");
  }
}

/**
 * Regenerate a single day within an existing itinerary.
 *
 * Unlike `generateItinerary` (whole trip) and `regenerateSingleActivity`
 * (one activity), this produces a fresh ItineraryDay that complements the
 * surrounding days — different theme, no duplicate places, same vibe/budget.
 *
 * Pass `dayContext.surroundingDays` so the model can avoid repeating the
 * neighborhoods/places already in the trip. Pass `instructions` to nudge
 * the result (e.g., "make it more relaxed", "focus on food").
 */
export interface RegenerateDayParams {
  destination: string;
  dayNumber: number; // 1-indexed
  date: string; // YYYY-MM-DD — preserved on the output
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  vibes: string[];
  /** All other days in the trip (for context + dedup). Excludes the day being replaced. */
  surroundingDays: ItineraryDay[];
  /** Optional user-provided steering (e.g., "less walking", "focus on food"). */
  instructions?: string;
  profilePreferences?: UserProfilePreferences;
  language?: "en" | "es" | "it";
  /**
   * Trip's travel style — pass "backpacker" so the regenerated day
   * matches the rest of the trip (hostels, free activities, social).
   * Read from trip_meta.travel_style at the call site. Defaults to
   * "classic" when omitted. Bug fix 2026-05-28: without this, "regen
   * day 3" on a backpacker trip returned classic content and the
   * itinerary became internally inconsistent.
   */
  travelStyle?: "classic" | "backpacker";
}

export async function regenerateSingleDay(
  params: RegenerateDayParams & { userId?: string },
  retryCount = 0
): Promise<ItineraryDay> {
  // Dedup only the first call; retries bypass.
  if (retryCount === 0) {
    const dedupKey = getDayDedupKey({
      destination: params.destination,
      dayNumber: params.dayNumber,
      budgetTier: params.budgetTier,
      instructions: params.instructions,
    });
    return withDeduplication(dedupKey, () =>
      regenerateSingleDayInternal(params, retryCount)
    );
  }
  return regenerateSingleDayInternal(params, retryCount);
}

async function regenerateSingleDayInternal(
  params: RegenerateDayParams & { userId?: string },
  retryCount = 0
): Promise<ItineraryDay> {
  const MAX_RETRIES = 2;
  const startTime = performance.now();
  // day-regenerate → gemini-2.5-flash (balanced quality/cost for a single day).
  const modelName = getModelForPurpose("day-regenerate");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // 2026-05-31: lowered from 1.1/0.8 → 0.5/0.3 (deterministic utility task).
      // Day-regenerate is a utility call — the "different shape than the day
      // being replaced" pressure is already supplied by the surrounding-days
      // context + existing-places exclusion list, so the temperature lift was
      // double-counting it. Lower temp → better prompt-cache reuse on the
      // common case (same trip, same day, retry) and reproducible behavior
      // for debugging / E2E tests.
      temperature: retryCount > 0 ? 0.3 : 0.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048, // One day is ~500-800 tokens; this leaves headroom.
      responseMimeType: "application/json",
    },
  });

  // Build context strings from surrounding days
  const surroundingContext = params.surroundingDays
    .map(
      (d) =>
        `Day ${d.day_number} (${d.date}) — ${d.theme || "General"}: ${d.activities
          .map((a) => a.name)
          .join(", ")}`
    )
    .join("\n");

  const existingPlaces = Array.from(
    new Set(
      params.surroundingDays.flatMap((d) => d.activities.map((a) => a.name))
    )
  ).join(", ");

  const languageInstruction = getLanguageInstruction(params.language);
  const profileSection = buildProfilePreferencesSection(params.profilePreferences);
  const schedulingSection = buildSchedulingPreferencesSection(
    params.profilePreferences
  );

  const userPrompt = `${languageInstruction}Regenerate Day ${params.dayNumber} of a ${params.surroundingDays.length + 1}-day trip to ${params.destination}.

## What to Replace
- Day number: ${params.dayNumber}
- Date: ${params.date}
- This day will REPLACE the current Day ${params.dayNumber}. The other days remain unchanged.

## Surrounding Days (do NOT change these — only generate Day ${params.dayNumber})
${surroundingContext || "(no other days)"}

## Already-Visited Places (do NOT include any of these)
${existingPlaces || "(none)"}

## Trip Parameters
- Destination: ${params.destination}
- Budget Tier: ${params.budgetTier}
- Pace: ${params.pace}
- Vibes: ${params.vibes.join(", ") || "general"}
${params.travelStyle === "backpacker" ? `\n## BACKPACKER MODE\nThis is a backpacker trip. The replacement day must match the rest of the trip in style:\n- Hostels (not hotels), street food / markets / casual eateries\n- Free walking tours, viewpoints, parks, free museums\n- Public transit, walking, intercity buses (no taxis except safety)\n- At least one explicitly social activity (pub crawl, walking tour, hostel-organised event)\n- Avoid expensive guided tours and upscale dining\n` : ""}${params.instructions ? `\n## User Instructions for this day\n${params.instructions}\n` : ""}${profileSection}${schedulingSection}

## Required JSON Output

Return ONE day object (NOT an array) with this exact shape:

{
  "day_number": ${params.dayNumber},
  "date": "${params.date}",
  "theme": "A theme that complements but DIFFERS from the surrounding days",
  "activities": [
    {
      "time_slot": "morning",
      "start_time": "09:00",
      "duration_minutes": 120,
      "name": "Real Place Name",
      "type": "attraction",
      "description": "What to do here (2-3 sentences)",
      "location": "Neighborhood",
      "address": "Full street address",
      "coordinates": { "lat": 48.858370, "lng": 2.294481 },
      "official_website": "https://...",
      "estimated_cost": { "amount": 25, "currency": "USD", "tier": "moderate" },
      "tips": ["One tip"],
      "booking_required": false
    }
  ]
}

Rules:
1. Return ONLY the JSON object for the day. No markdown, no array, no extra text.
2. day_number MUST be exactly ${params.dayNumber}; date MUST be exactly "${params.date}".
3. Include 3-5 activities based on ${params.pace} pace.
4. Do NOT include any place from the already-visited list.
5. Use PRECISE coordinates (6 decimal places).`;

  const regenerateDaySystemPrompt = await getPrompt("regenerate_day");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: regenerateDaySystemPrompt }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I will return a single day object as valid JSON.",
              },
            ],
          },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "Day regeneration"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    logCacheMetrics("regenerateSingleDay", response.usageMetadata);

    try {
      // Gemini occasionally wraps the day in an array even when asked not to.
      // Be lenient — accept either { day_number, ... } or [{ day_number, ... }].
      const parsed = JSON.parse(text) as ItineraryDay | ItineraryDay[];
      const day = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!day || !day.activities || !Array.isArray(day.activities) || day.activities.length === 0) {
        throw new Error("Invalid day structure: missing activities");
      }

      // Force day_number and date to the requested values so the UI can
      // splice the result back in without checking the model's choice.
      day.day_number = params.dayNumber;
      day.date = params.date;

      // Stamp IDs on each activity so the UI's drag/edit code paths work.
      for (const activity of day.activities) {
        if (!activity.id) {
          activity.id = generateActivityId();
        }
      }

      // Reuse the trip-wide coordinate fixer for any missing lat/lng.
      const fixed = validateAndFixCoordinates([day], params.destination)[0];

      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleDay",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          day_number: params.dayNumber,
          activities_count: fixed.activities.length,
          budget_tier: params.budgetTier,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return fixed;
    } catch (parseError) {
      console.error(
        `Day regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleDay",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          day_number: params.dayNumber,
          retry_count: retryCount,
        },
      }).catch(() => {});

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying day regeneration (attempt ${retryCount + 2})...`);
        return regenerateSingleDayInternal(params, retryCount + 1);
      }
      throw new Error("Failed to regenerate day after retries");
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error during day regeneration:", error);

    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "regenerateSingleDay",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        day_number: params.dayNumber,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return regenerateSingleDayInternal(params, retryCount + 1);
    }
    throw new Error("Failed to regenerate day: AI service unavailable");
  }
}

// Input validation — defense-in-depth against prompt injection
const DANGEROUS_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /disregard\s+(all\s+)?prior/gi,
  /you\s+are\s+now/gi,
  /pretend\s+to\s+be/gi,
  /system\s+prompt/gi,
  /\[INST\]/gi,
  /<<SYS>>/gi,
  /new\s+persona/gi,
  /override\s+(your|the|all)/gi,
  /forget\s+everything/gi,
  /do\s+not\s+follow/gi,
  /bypass\s+(the\s+)?filter/gi,
  /act\s+as\s+(a|an|if)/gi,
  /roleplay\s+as/gi,
  /jailbreak/gi,
  /DAN\s+mode/gi,
  /developer\s+mode/gi,
  /respond\s+as\s+if/gi,
  /reveal\s+(your|the)\s+(system|instructions|prompt)/gi,
  /what\s+are\s+your\s+instructions/gi,
];

const BLACKLIST = [
  "<script",
  "</script",
  "javascript:",
  "eval(",
  "onerror=",
  "onload=",
];

// Destination must look like a geographic name — letters, spaces, hyphens, commas, dots, parentheses, apostrophes
const DESTINATION_ALLOWLIST = /^[\p{L}\p{M}\s\-,.'()&/0-9]+$/u;

export function validateTripParams(
  params: TripCreationParams
): { valid: boolean; error?: string } {
  // Destination validation
  if (!params.destination || params.destination.length < 2) {
    return { valid: false, error: "Destination is required" };
  }

  if (params.destination.length > 100) {
    return { valid: false, error: "Destination name too long" };
  }

  // Whitelist: destination must contain only geographic-name characters
  if (!DESTINATION_ALLOWLIST.test(params.destination)) {
    return { valid: false, error: "Destination contains invalid characters" };
  }

  // Check for blacklisted content in destination
  const destLower = params.destination.toLowerCase();
  for (const blocked of BLACKLIST) {
    if (destLower.includes(blocked.toLowerCase())) {
      return { valid: false, error: "Invalid characters in destination" };
    }
  }

  // Check for prompt injection in destination
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(params.destination)) {
      return { valid: false, error: "Invalid input detected" };
    }
  }

  // Validate requirements field if present
  if (params.requirements) {
    if (params.requirements.length > 500) {
      return { valid: false, error: "Requirements text too long (max 500 characters)" };
    }
    for (const blocked of BLACKLIST) {
      if (params.requirements.toLowerCase().includes(blocked.toLowerCase())) {
        return { valid: false, error: "Invalid characters in requirements" };
      }
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(params.requirements)) {
        return { valid: false, error: "Invalid input detected" };
      }
    }
  }

  // Date validation
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: "Invalid date format" };
  }

  if (start < now) {
    return { valid: false, error: "Start date cannot be in the past" };
  }

  if (end <= start) {
    return { valid: false, error: "End date must be after start date" };
  }

  const days =
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (days > 14) {
    return { valid: false, error: "Maximum trip duration is 14 days" };
  }

  // Budget tier validation
  const validTiers = ["budget", "balanced", "premium"];
  if (!validTiers.includes(params.budgetTier)) {
    return { valid: false, error: "Invalid budget tier" };
  }

  // Interests validation
  if (params.interests && params.interests.length > 10) {
    return { valid: false, error: "Maximum 10 interests allowed" };
  }

  // Vibes validation
  const validVibes = [
    "adventure", "cultural", "foodie", "wellness",
    "romantic", "urban", "nature", "offbeat",
    "wonderland", "movie-magic", "fairytale", "retro"
  ];
  if (params.vibes) {
    if (params.vibes.length === 0) {
      return { valid: false, error: "At least one vibe is required" };
    }
    if (params.vibes.length > 3) {
      return { valid: false, error: "Maximum 3 vibes allowed" };
    }
    for (const vibe of params.vibes) {
      if (!validVibes.includes(vibe)) {
        return { valid: false, error: `Invalid vibe: ${vibe}` };
      }
    }
  }

  return { valid: true };
}

/**
 * Parameters for generating additional days of an itinerary
 */
export interface GenerateMoreDaysParams {
  destination: string;
  startDate: string; // Original trip start date
  endDate: string;   // Original trip end date
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "packed";
  vibes: string[];
  existingDays: ItineraryDay[]; // Days already generated
  startFromDay: number; // Day number to start generating (1-indexed)
  daysToGenerate: number; // Number of days to generate
  profilePreferences?: UserProfilePreferences;
  language?: "en" | "es" | "it";
}

// Continue generation prompt - now loaded from database via getPrompt()
// See lib/prompts.ts for default values

/**
 * Generate additional days for an existing itinerary
 * Used for incremental loading of long trips (5+ days)
 */
export async function generateMoreDays(
  params: GenerateMoreDaysParams & { userId?: string },
  retryCount = 0
): Promise<ItineraryDay[]> {
  // Generate deduplication key - note: only first call gets deduplicated, retries bypass
  if (retryCount === 0) {
    const dedupKey = getMoreDaysDedupKey({
      destination: params.destination,
      startFromDay: params.startFromDay,
      daysToGenerate: params.daysToGenerate,
      budgetTier: params.budgetTier,
      pace: params.pace,
    });

    return withDeduplication(dedupKey, () =>
      generateMoreDaysInternal(params, retryCount)
    );
  }

  // Retries bypass deduplication
  return generateMoreDaysInternal(params, retryCount);
}

/**
 * Internal more days generation function (without deduplication wrapper)
 */
async function generateMoreDaysInternal(
  params: GenerateMoreDaysParams & { userId?: string },
  retryCount = 0
): Promise<ItineraryDay[]> {
  const MAX_RETRIES = 2;
  const startTime = performance.now();
  // generate-more-days → gemini-2.5-flash (continuation; needs context coherence).
  const modelName = getModelForPurpose("generate-more-days");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: retryCount > 0 ? 0.7 : 1.0,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192, // Increased to support longer trips
      responseMimeType: "application/json",
    },
  });

  // Build context from existing days
  const existingContext = params.existingDays
    .slice(-2) // Last 2 days for context
    .map(d => `Day ${d.day_number} (${d.date}): ${d.theme} - ${d.activities.map(a => a.name).join(", ")}`)
    .join("\n");

  // List all existing activity names to avoid repetition
  const existingActivities = params.existingDays
    .flatMap(d => d.activities.map(a => a.name))
    .join(", ");

  // Calculate the date for the first day to generate
  const startDateObj = new Date(params.startDate);
  startDateObj.setDate(startDateObj.getDate() + params.startFromDay - 1);
  const generationStartDate = startDateObj.toISOString().split("T")[0];

  const languageInstruction = getLanguageInstruction(params.language);

  // Build profile preferences sections for the prompt
  const profileSection = buildProfilePreferencesSection(params.profilePreferences);
  const schedulingSection = buildSchedulingPreferencesSection(params.profilePreferences);

  const userPrompt = `${languageInstruction}Continue the itinerary for ${params.destination}.

## Existing Days (for context)
${existingContext}

## Do NOT include these places (already visited):
${existingActivities}
${profileSection}${schedulingSection}
## Generate Days ${params.startFromDay} to ${params.startFromDay + params.daysToGenerate - 1}
- First day date: ${generationStartDate}
- Number of days: ${params.daysToGenerate}
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace}
- Vibes: ${params.vibes.join(", ")}

## Required JSON Output

Return an array of days:
[
  {
    "day_number": ${params.startFromDay},
    "date": "${generationStartDate}",
    "theme": "Day theme (e.g., Beach Day)",
    "activities": [
      {
        "time_slot": "morning",
        "start_time": "09:00",
        "duration_minutes": 120,
        "name": "Real Place Name",
        "type": "attraction",
        "description": "What to do here",
        "location": "Neighborhood",
        "address": "Full street address",
        "coordinates": {
          "lat": 48.858370,
          "lng": 2.294481
        },
        "official_website": null,
        "estimated_cost": {
          "amount": 25,
          "currency": "USD",
          "tier": "moderate"
        },
        "tips": ["Tip"],
        "booking_required": false
      }
    ]
  }
]

Rules:
1. Return ONLY valid JSON array, no markdown
2. Each day should have 3-5 activities based on ${params.pace} pace
3. Avoid ALL places already visited
4. Use PRECISE coordinates with 6 decimal places (e.g., 48.858370) for exact locations
5. Dates increment from ${generationStartDate}`;

  // Fetch continue generation prompt from database (with caching and fallback)
  const continueSystemPrompt = await getPrompt("continue_generation");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: continueSystemPrompt }] },
          { role: "model", parts: [{ text: "Understood. I will generate continuation days as a valid JSON array." }] },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "More days generation"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("generateMoreDays", response.usageMetadata);

    try {
      const days = JSON.parse(text) as ItineraryDay[];

      // Validate it's an array with days
      if (!Array.isArray(days) || days.length === 0) {
        throw new Error("Invalid days array structure");
      }

      // Validate each day has required fields
      for (const day of days) {
        if (!day.day_number || !day.date || !day.activities) {
          throw new Error("Invalid day structure");
        }
      }

      // Validate and fix coordinates for all activities
      const validatedDays = validateAndFixCoordinates(days, params.destination);

      // Capture LLM analytics (fire and forget)
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "generateMoreDays",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          days_generated: days.length,
          start_from_day: params.startFromDay,
          budget_tier: params.budgetTier,
          pace: params.pace,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return validatedDays;
    } catch (parseError) {
      console.error(
        `JSON parse error in generateMoreDays (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      // Capture failed attempt analytics
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "generateMoreDays",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          retry_count: retryCount,
        },
      }).catch(() => {});

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying generateMoreDays (attempt ${retryCount + 2})...`);
        return generateMoreDaysInternal(params, retryCount + 1);
      }

      throw new Error("Failed to generate more days after retries");
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error in generateMoreDays:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "generateMoreDays",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return generateMoreDaysInternal(params, retryCount + 1);
    }

    throw new Error("Failed to generate more days: AI service unavailable");
  }
}

// ============================================================================
// STREAMING ITINERARY GENERATION (Phase 2F)
// ============================================================================

/**
 * Yield type for `generateItineraryStream`. Each chunk carries the
 * incremental text Gemini emitted since the last yield. The terminal
 * yield is signalled by `done=true` and includes the fully-accumulated
 * text plus usage metadata.
 */
export interface StreamChunk {
  text: string; // incremental delta this chunk
  done: false;
}

export interface StreamFinal {
  text: ""; // empty delta — fullText is the canonical accumulation
  done: true;
  fullText: string;
  latencyMs: number;
  usageMetadata?: GeminiUsageMetadata;
}

export type StreamYield = StreamChunk | StreamFinal;

/**
 * Streaming counterpart to `generateItinerary`. Returns an async
 * generator that yields each partial-response chunk from Gemini, then
 * a terminal {done:true, fullText} payload.
 *
 * Caller responsibilities:
 *   - Maintain a streaming parser (see lib/streaming/day-parser.ts) to
 *     extract complete day objects from the running text
 *   - On terminal yield, do a full JSON.parse(fullText) to get the
 *     canonical GeneratedItinerary (use for cache writes, sanitization,
 *     image fetching)
 *   - Emit SSE events as days arrive (see lib/streaming/sse.ts)
 *
 * Differences from `generateItinerary`:
 *   - No retry-on-parse-failure loop. Streaming + retry would require
 *     replaying earlier chunks to the client, which we don't want. If
 *     the final parse fails, caller emits an SSE error.
 *   - No coordinate-fix pass — caller runs it on the parsed result.
 *   - No deduplication wrapper — concurrent streams to the same dest
 *     are rare (cache layer handles popular dests) and dedup would
 *     require fan-out, which is complex.
 *
 * Throws on Gemini API errors before the first chunk. Errors during
 * streaming surface as a rejected `next()` call — caller should
 * try/catch the `for await` block.
 */
export async function* generateItineraryStream(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): AsyncGenerator<StreamYield, void, unknown> {
  const startTime = performance.now();
  // Streaming trip generation → same purpose as the non-streaming path.
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
      // 2026-06-01: raised 6000 → 8000 after the thinkingConfig fix
      // below landed. Live test with that fix in place: 3-day
      // Reykjavik completed cleanly (26s, ~5300 tokens), but 5-day
      // Porto truncated at position 21102 (~7000 tokens). The
      // 2026-05-31 audit assumed 6000 was the right cap because of
      // implicit-thinking inflation; with thinking off, the cap can
      // float back up to give 5-7 day trips room to finish without
      // re-introducing the silent truncation. Output is billed per
      // actual emitted tokens, not per cap, so steady-state cost is
      // unchanged. The 8000 ceiling supports trips up to ~10 days
      // (the 14-day max would still risk truncation; revisit only if
      // 8-14 day trip volume becomes material).
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
      // 2026-06-01 P0 FIX: disable extended thinking on the streaming
      // path, matching the non-streaming path's fix from commit 83eaf7f.
      //
      // Symptom: live-reproduced 2026-06-01 ~05:55 UTC — Buenos Aires
      // 6-day Scoperta Urbana request returned "Unterminated string in
      // JSON at position 733 (line 13 column 25)" to the wizard.
      // Retried; failed identically with truncation at a different
      // offset. NEVER reached the result page → fetchActivityImages
      // never ran → the perf(places) SKU split could not be verified.
      //
      // Root cause: gemini-2.5-flash defaults to extended thinking ON.
      // Thinking tokens count against `maxOutputTokens` (the 6000 cap
      // above). For a 6-day trip with 4+ activities/day the answer
      // alone is ~4500-5500 tokens — any thinking budget at all
      // pushes the answer past the cap and the SSE stream emits a
      // valid prefix of an invalid JSON. `JSON.parse(fullText)` then
      // throws "Unterminated string at position N" downstream in
      // parseStreamedItinerary.
      //
      // The non-streaming generateItineraryInternal (line 687-700)
      // already disables thinking via this same cast. This restores
      // parity. The legacy @google/generative-ai SDK (0.24.x) lacks
      // thinkingConfig in its TS types; the REST API has accepted it
      // since 2025-Q2.
      //
      // Why not raise maxOutputTokens instead? Output tokens are
      // billed; the 6000 cap is what cut output cost ~25% in the
      // 2026-05-31 audit. Killing thinking is free.
      ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
    },
  });

  const systemPrompt = await getPrompt("trip_generation_system");
  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: systemPrompt }] },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I will generate travel itineraries following these rules, returning only valid JSON matching the specified schema.",
          },
        ],
      },
    ],
  });

  const userPrompt = buildUserPrompt(params, options);

  // sendMessageStream returns { stream: AsyncIterable, response: Promise }
  // The `stream` iterates partial responses; `response` resolves to the
  // final aggregated response after the stream completes.
  const result = await chat.sendMessageStream(userPrompt);

  let fullText = "";
  try {
    for await (const partial of result.stream) {
      // Each partial may yield zero text if it's a control message
      // (e.g. safety scores updated). Defensive: only yield when
      // there's actual text.
      const delta = partial.text();
      if (delta) {
        fullText += delta;
        yield { text: delta, done: false };
      }
    }
  } catch (err) {
    // Async-iter rejections are silently dropped by `for await` in some
    // engines; explicit rethrow keeps the caller's try/catch effective.
    throw err instanceof Error ? err : new Error(String(err));
  }

  // Aggregate final response. CRITICAL: the canonical text is
  // finalResponse.text(), NOT the accumulated `fullText` from deltas.
  // The async-iter `for await` can silently drop chunks under back-
  // pressure (observed live: a 4-day Lisbon trip produced ~13KB of
  // delta'd text but truncated mid-property at position 13018, while
  // finalResponse.text() returned the complete 14KB JSON). Use the
  // final aggregate as truth.
  const finalResponse = await result.response;
  const canonicalText = finalResponse.text();
  const latencyMs = performance.now() - startTime;
  logCacheMetrics("generateItineraryStream", finalResponse.usageMetadata);

  // Fire-and-forget LLM analytics — same shape as generateItinerary.
  captureLLMGeneration({
    distinctId: options?.userId || "anonymous",
    model: modelName,
    endpoint: "generateItineraryStream",
    usageMetadata: finalResponse.usageMetadata as GeminiUsageMetadata,
    latencyMs,
    success: true,
    properties: {
      destination: params.destination,
      budget_tier: params.budgetTier,
      pace: params.pace,
      vibes: params.vibes,
    },
  }).catch(() => {});

  yield {
    text: "",
    done: true,
    fullText: canonicalText,
    latencyMs,
    usageMetadata: finalResponse.usageMetadata as GeminiUsageMetadata,
  };
}

/**
 * Validate the streamed itinerary JSON and apply the post-processing
 * the non-streaming path does (coordinate fixing). Returns the cleaned
 * GeneratedItinerary or throws on parse/validation failure.
 */
export function parseStreamedItinerary(
  fullText: string,
  params: TripCreationParams
): GeneratedItinerary {
  const itinerary = JSON.parse(fullText) as GeneratedItinerary;
  if (!itinerary.destination || !itinerary.days || itinerary.days.length === 0) {
    throw new Error("Invalid itinerary structure");
  }
  itinerary.days = validateAndFixCoordinates(itinerary.days, params.destination);
  return itinerary;
}
