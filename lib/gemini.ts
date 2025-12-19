import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeneratedItinerary, TripCreationParams, Activity, ItineraryDay, UserProfilePreferences } from "@/types";
import { generateActivityId } from "./utils/activity-id";
import { getPrompt, DEFAULT_PROMPTS } from "./prompts";

// Threshold for incremental generation (days)
// NOTE: Incremental generation is disabled (threshold set to 99) because:
// 1. The frontend never implemented the handler for loading remaining days
// 2. Users were only getting 3 days for 7+ day trips
// 3. Full generation with increased token limit is more reliable
export const INCREMENTAL_GENERATION_THRESHOLD = 99; // Effectively disabled
export const INITIAL_DAYS_TO_GENERATE = 14; // Max trip length

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/**
 * Log Gemini response usage metadata for cache monitoring
 * Tracks implicit caching stats to verify cost savings
 */
function logCacheMetrics(
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
    totalTokenCount = 0,
  } = usageMetadata;

  const cacheHitRate = promptTokenCount > 0
    ? ((cachedContentTokenCount / promptTokenCount) * 100).toFixed(1)
    : "0.0";

  // Log cache metrics for monitoring
  console.log(
    `[Gemini Cache] ${endpoint}: ` +
    `prompt=${promptTokenCount}, output=${candidatesTokenCount}, ` +
    `cached=${cachedContentTokenCount} (${cacheHitRate}% cache hit)`
  );

  // Calculate cost savings (cached tokens are 75% cheaper)
  if (cachedContentTokenCount > 0) {
    const regularCost = cachedContentTokenCount * 0.00001; // $0.01 per 1K tokens
    const cachedCost = cachedContentTokenCount * 0.0000025; // $0.0025 per 1K cached tokens
    const savings = regularCost - cachedCost;
    console.log(`[Gemini Cache] Savings: $${savings.toFixed(6)} from cached tokens`);
  }
}

// Model configurations
// Updated to Gemini 2.5 for implicit caching (75-90% discount on cached tokens)
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
  if (activeHoursStart < 0 || activeHoursStart > 23) return "";
  if (activeHoursEnd < 0 || activeHoursEnd > 23) return "";

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
        activity.coordinates.lat !== 0 &&
        activity.coordinates.lng !== 0;

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

  return `Plan a ${duration}-day trip to ${params.destination}.${partialNote}

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
- Duration: ${duration} days${options?.isPartial ? ` (partial - generating first ${duration} of ${totalDuration})` : ""}
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace}

${vibeSection}${seasonalSection}## Traveler Preferences
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
            "lat": 48.8584,
            "lng": 2.2945
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
7. EVERY activity MUST have valid coordinates (lat/lng) - this is critical for map display`;
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
  options?: GenerationOptions
): Promise<GeneratedItinerary> {
  const retryCount = options?.retryCount ?? 0;
  const MAX_RETRIES = 2;

  const model = genAI.getGenerativeModel({
    model: MODELS.fast,
    generationConfig: {
      temperature: retryCount > 0 ? 0.7 : 1.0, // Lower temperature on retry
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192, // Increased to support trips up to 14 days (~750 tokens/day)
      responseMimeType: "application/json",
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
    const result = await chat.sendMessage(userPrompt);
    const response = result.response;
    const text = response.text();

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

      return itinerary;
    } catch (parseError) {
      console.error(
        `JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      // Retry with lower temperature
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying generation (attempt ${retryCount + 2})...`);
        return generateItinerary(params, { ...options, retryCount: retryCount + 1 });
      }

      throw new Error("Failed to generate valid itinerary after retries");
    }
  } catch (error) {
    // Handle API errors (rate limits, network issues, etc.)
    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error:", error);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return generateItinerary(params, { ...options, retryCount: retryCount + 1 });
    }

    throw new Error("Failed to generate itinerary: AI service unavailable");
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
}

// Activity regeneration prompt - now loaded from database via getPrompt()
// See lib/prompts.ts for default values

export async function regenerateSingleActivity(
  params: RegenerateActivityParams,
  retryCount = 0
): Promise<Activity> {
  const MAX_RETRIES = 2;

  const model = genAI.getGenerativeModel({
    model: MODELS.fast,
    generationConfig: {
      temperature: retryCount > 0 ? 0.8 : 1.2, // Higher temperature for variety
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const { activityToReplace, dayContext, existingActivityNames, preferences } = params;

  const userPrompt = `Generate a replacement activity for a trip to ${params.destination}.

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
    "lat": 48.8584,
    "lng": 2.2945
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
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: regenerateSystemPrompt }] },
        { role: "model", parts: [{ text: "Understood. I will generate a single replacement activity as valid JSON." }] },
        { role: "user", parts: [{ text: userPrompt }] },
      ],
    });

    const response = result.response;
    const text = response.text();

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

      return activity;
    } catch (parseError) {
      console.error(
        `Activity regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 300)
      );

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying activity regeneration (attempt ${retryCount + 2})...`);
        return regenerateSingleActivity(params, retryCount + 1);
      }

      throw new Error("Failed to regenerate activity after retries");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error during activity regeneration:", error);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return regenerateSingleActivity(params, retryCount + 1);
    }

    throw new Error("Failed to regenerate activity: AI service unavailable");
  }
}

// Input validation
const DANGEROUS_PATTERNS = [
  /ignore previous instructions/gi,
  /disregard all prior/gi,
  /you are now/gi,
  /pretend to be/gi,
  /system prompt/gi,
  /\[INST\]/gi,
  /<<SYS>>/gi,
  /new persona/gi,
  /override your/gi,
  /forget everything/gi,
];

const BLACKLIST = [
  "<script>",
  "javascript:",
  "eval(",
  "SELECT ",
  "DROP ",
  "INSERT ",
  "DELETE ",
  "--",
  "/*",
  "*/",
  "UNION ",
  "OR 1=1",
];

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

  // Check for blacklisted content
  const destLower = params.destination.toLowerCase();
  for (const blocked of BLACKLIST) {
    if (destLower.includes(blocked.toLowerCase())) {
      return { valid: false, error: "Invalid characters in destination" };
    }
  }

  // Check for prompt injection
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(params.destination)) {
      return { valid: false, error: "Invalid input detected" };
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
}

// Continue generation prompt - now loaded from database via getPrompt()
// See lib/prompts.ts for default values

/**
 * Generate additional days for an existing itinerary
 * Used for incremental loading of long trips (5+ days)
 */
export async function generateMoreDays(
  params: GenerateMoreDaysParams,
  retryCount = 0
): Promise<ItineraryDay[]> {
  const MAX_RETRIES = 2;

  const model = genAI.getGenerativeModel({
    model: MODELS.fast,
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

  const userPrompt = `Continue the itinerary for ${params.destination}.

## Existing Days (for context)
${existingContext}

## Do NOT include these places (already visited):
${existingActivities}

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
          "lat": 48.8584,
          "lng": 2.2945
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
4. Dates increment from ${generationStartDate}`;

  // Fetch continue generation prompt from database (with caching and fallback)
  const continueSystemPrompt = await getPrompt("continue_generation");

  try {
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: continueSystemPrompt }] },
        { role: "model", parts: [{ text: "Understood. I will generate continuation days as a valid JSON array." }] },
        { role: "user", parts: [{ text: userPrompt }] },
      ],
    });

    const response = result.response;
    const text = response.text();

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

      return days;
    } catch (parseError) {
      console.error(
        `JSON parse error in generateMoreDays (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying generateMoreDays (attempt ${retryCount + 2})...`);
        return generateMoreDays(params, retryCount + 1);
      }

      throw new Error("Failed to generate more days after retries");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error in generateMoreDays:", error);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return generateMoreDays(params, retryCount + 1);
    }

    throw new Error("Failed to generate more days: AI service unavailable");
  }
}
