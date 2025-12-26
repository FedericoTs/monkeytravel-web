/**
 * Maps Grounding Module
 *
 * Uses Google Gemini with Maps Grounding to generate travel itineraries
 * with verified Google Places data and Place IDs.
 *
 * Cost: $0.025 per request (vs $0.78-1.70 for Gemini + Places API calls)
 * Savings: ~60% reduction in API costs per trip generation
 */

import type { TripCreationParams, Activity, ItineraryDay, GeneratedItinerary } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import { generateActivityId } from "./utils/activity-id";

// Maps Grounding API endpoint
const MAPS_GROUNDING_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Types for Maps Grounding API response
interface GroundingChunk {
  maps?: {
    uri: string;
    title: string;
    placeId: string;
  };
}

interface GroundingSupport {
  segment: { startIndex: number; endIndex: number; text?: string };
  groundingChunkIndices: number[];
  confidenceScores?: number[];
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
  googleMapsWidgetContextToken?: string;
}

interface MapsGroundingResponse {
  text: string;
  places: GroundedPlace[];
  groundingSupports: number;
  hasWidgetToken: boolean;
  responseTimeMs: number;
}

export interface GroundedPlace {
  title: string;
  placeId: string;
  mapsUri: string;
  // Additional fields populated from parsing
  type?: string;
  timeSlot?: string;
  dayNumber?: number;
  description?: string;
  duration?: number;
}

// Map TripCreationParams.budgetTier to Activity.estimated_cost.tier
type CostTier = "budget" | "moderate" | "free" | "expensive";
function mapBudgetToTier(budgetTier: string): CostTier {
  const tierMap: Record<string, CostTier> = {
    budget: "budget",
    balanced: "moderate",
    comfort: "moderate",
    premium: "expensive",
    luxury: "expensive",
  };
  return tierMap[budgetTier] || "moderate";
}

/**
 * Known destination coordinates for grounding proximity
 */
const DESTINATION_COORDINATES: Record<string, Coordinates> = {
  paris: { lat: 48.8566, lng: 2.3522 },
  rome: { lat: 41.9028, lng: 12.4964 },
  tokyo: { lat: 35.6762, lng: 139.6503 },
  london: { lat: 51.5074, lng: -0.1278 },
  "new york": { lat: 40.7128, lng: -74.006 },
  barcelona: { lat: 41.3851, lng: 2.1734 },
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  berlin: { lat: 52.52, lng: 13.405 },
  lisbon: { lat: 38.7223, lng: -9.1393 },
  prague: { lat: 50.0755, lng: 14.4378 },
  vienna: { lat: 48.2082, lng: 16.3738 },
  budapest: { lat: 47.4979, lng: 19.0402 },
  sydney: { lat: -33.8688, lng: 151.2093 },
  dubai: { lat: 25.2048, lng: 55.2708 },
  singapore: { lat: 1.3521, lng: 103.8198 },
  bangkok: { lat: 13.7563, lng: 100.5018 },
  bali: { lat: -8.3405, lng: 115.092 },
  milan: { lat: 45.4642, lng: 9.19 },
  florence: { lat: 43.7696, lng: 11.2558 },
  venice: { lat: 45.4408, lng: 12.3155 },
  athens: { lat: 37.9838, lng: 23.7275 },
  madrid: { lat: 40.4168, lng: -3.7038 },
  santorini: { lat: 36.3932, lng: 25.4615 },
  mykonos: { lat: 37.4467, lng: 25.3289 },
  amalfi: { lat: 40.634, lng: 14.6027 },
  cinque_terre: { lat: 44.1461, lng: 9.6439 },
  "cape town": { lat: -33.9249, lng: 18.4241 },
  marrakech: { lat: 31.6295, lng: -7.9811 },
};

/**
 * Get coordinates for a destination
 */
function getDestinationCoordinates(destination: string): Coordinates {
  const normalized = destination.toLowerCase().trim();

  // Direct match
  if (DESTINATION_COORDINATES[normalized]) {
    return DESTINATION_COORDINATES[normalized];
  }

  // First word match (e.g., "Paris, France" -> "paris")
  const firstWord = normalized.split(/[,\s]+/)[0];
  if (DESTINATION_COORDINATES[firstWord]) {
    return DESTINATION_COORDINATES[firstWord];
  }

  // Default to Paris as fallback
  console.warn(`[MapsGrounding] Unknown destination: ${destination}, using Paris coordinates`);
  return DESTINATION_COORDINATES.paris;
}

/**
 * Build the prompt for Maps Grounding
 * Optimized for extracting places with grounding metadata
 */
function buildGroundingPrompt(params: TripCreationParams): string {
  const duration =
    Math.ceil(
      (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

  const vibeLabels: Record<string, string> = {
    adventure: "adventure activities and outdoor experiences",
    cultural: "museums, heritage sites, and local traditions",
    foodie: "food markets, local restaurants, and culinary experiences",
    wellness: "spas, yoga studios, and peaceful retreats",
    romantic: "intimate spots and sunset viewpoints",
    urban: "city life, nightlife, and architecture",
    nature: "parks, gardens, and natural attractions",
    offbeat: "hidden gems and non-touristy spots",
  };

  const vibesText =
    params.vibes && params.vibes.length > 0
      ? params.vibes.map((v) => vibeLabels[v] || v).join(", ")
      : "general sightseeing";

  const budgetText: Record<string, string> = {
    budget: "budget-friendly and affordable",
    balanced: "moderate pricing",
    comfort: "comfortable mid-range",
    premium: "upscale and premium",
    luxury: "ultra-luxury and exclusive",
  };
  const budgetDescription = budgetText[params.budgetTier] || "moderate";

  const paceOptions: Record<string, string> = {
    relaxed: "2-3 activities per day with plenty of rest time",
    moderate: "3-4 activities per day with reasonable pacing",
    active: "4-5 activities per day for maximum exploration",
  };
  const paceDescription = paceOptions[params.pace] || "3-4 activities per day";

  return `Create a detailed ${duration}-day travel itinerary for ${params.destination}.

Travel Preferences:
- Style: ${vibesText}
- Budget: ${budgetDescription}
- Pace: ${paceDescription}
- Dates: ${params.startDate} to ${params.endDate}

For each day, provide:
- Day number and theme
- Morning activity (9:00-12:00): specific attraction, museum, or experience
- Lunch spot (12:30-14:00): specific restaurant with cuisine type
- Afternoon activity (14:30-18:00): specific attraction or experience
- Dinner restaurant (19:00-21:00): specific restaurant with cuisine type

IMPORTANT REQUIREMENTS:
1. Use REAL, SPECIFIC place names that exist on Google Maps
2. Include the EXACT name of each restaurant, museum, attraction
3. Mention the neighborhood or area for each location
4. Include a mix of: famous landmarks, local favorites, hidden gems
5. For restaurants, mention the cuisine type
6. Ensure activities are geographically logical (minimize travel between locations)

Format each activity clearly with the place name prominently displayed.
Include at least ${duration * 4} specific places total.`;
}

/**
 * Call the Maps Grounding API
 */
export async function callMapsGrounding(
  params: TripCreationParams
): Promise<MapsGroundingResponse> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }

  const coordinates = getDestinationCoordinates(params.destination);
  const prompt = buildGroundingPrompt(params);
  const startTime = Date.now();

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    tools: [
      {
        googleMaps: {},
      },
    ],
    toolConfig: {
      retrievalConfig: {
        latLng: {
          latitude: coordinates.lat,
          longitude: coordinates.lng,
        },
      },
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      // NOTE: Cannot use responseMimeType: "application/json" with Maps Grounding
    },
  };

  const response = await fetch(`${MAPS_GROUNDING_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const responseTimeMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[MapsGrounding] API Error (${response.status}):`, errorText);
    throw new Error(`Maps Grounding API error: ${response.status}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  if (!candidate) {
    throw new Error("No candidate in Maps Grounding response");
  }

  const text = candidate.content?.parts?.[0]?.text || "";
  const groundingMetadata: GroundingMetadata = candidate.groundingMetadata || {};

  // Extract grounded places
  const places: GroundedPlace[] = (groundingMetadata.groundingChunks || [])
    .filter((chunk): chunk is { maps: { uri: string; title: string; placeId: string } } =>
      chunk.maps !== undefined
    )
    .map((chunk) => ({
      title: chunk.maps.title,
      placeId: chunk.maps.placeId,
      mapsUri: chunk.maps.uri,
    }));

  console.log(
    `[MapsGrounding] Generated itinerary for ${params.destination}: ${places.length} places grounded in ${responseTimeMs}ms`
  );

  return {
    text,
    places,
    groundingSupports: groundingMetadata.groundingSupports?.length || 0,
    hasWidgetToken: !!groundingMetadata.googleMapsWidgetContextToken,
    responseTimeMs,
  };
}

/**
 * Parse the grounded response text to extract structured activities
 * Maps grounded places to day/time slots based on text analysis
 */
function parseGroundedItinerary(
  text: string,
  places: GroundedPlace[],
  params: TripCreationParams
): ItineraryDay[] {
  const duration =
    Math.ceil(
      (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

  // Create a map of place titles (lowercase) to their grounded data
  const placeMap = new Map<string, GroundedPlace>();
  places.forEach((place) => {
    placeMap.set(place.title.toLowerCase(), place);
  });

  const days: ItineraryDay[] = [];

  // Parse text by day patterns
  const dayPatterns = [
    /day\s*(\d+)[:\s-]*([^\n]*)?/gi,
    /\*\*day\s*(\d+)\*\*/gi,
    /##\s*day\s*(\d+)/gi,
  ];

  // Split text into sections by day
  const textLower = text.toLowerCase();
  const sections: { dayNum: number; content: string }[] = [];

  for (let d = 1; d <= duration; d++) {
    const dayRegex = new RegExp(`day\\s*${d}[^\\d]`, "gi");
    const nextDayRegex = new RegExp(`day\\s*${d + 1}[^\\d]`, "gi");

    const startMatch = dayRegex.exec(text);
    if (!startMatch) continue;

    const startIdx = startMatch.index;
    const nextMatch = nextDayRegex.exec(text);
    const endIdx = nextMatch ? nextMatch.index : text.length;

    sections.push({
      dayNum: d,
      content: text.substring(startIdx, endIdx),
    });
  }

  // Time slot patterns for activity detection
  const timeSlotPatterns = [
    { slot: "morning", patterns: [/morning/i, /9:\d{2}/i, /10:\d{2}/i, /11:\d{2}/i, /breakfast/i] },
    { slot: "afternoon", patterns: [/afternoon/i, /lunch/i, /12:\d{2}/i, /13:\d{2}/i, /14:\d{2}/i, /15:\d{2}/i, /16:\d{2}/i, /17:\d{2}/i] },
    { slot: "evening", patterns: [/evening/i, /dinner/i, /18:\d{2}/i, /19:\d{2}/i, /20:\d{2}/i, /21:\d{2}/i, /night/i] },
  ];

  // Activity type detection
  const typePatterns: Record<string, RegExp[]> = {
    restaurant: [/restaurant/i, /cafe/i, /bistro/i, /trattoria/i, /eatery/i, /lunch/i, /dinner/i, /breakfast/i, /cuisine/i, /food/i],
    attraction: [/museum/i, /gallery/i, /palace/i, /castle/i, /monument/i, /landmark/i, /tower/i, /cathedral/i, /church/i, /basilica/i],
    activity: [/tour/i, /walk/i, /experience/i, /class/i, /workshop/i, /market/i, /shopping/i],
    nature: [/park/i, /garden/i, /beach/i, /viewpoint/i, /sunset/i],
  };

  // Process each day section
  for (const section of sections) {
    const dayDate = new Date(params.startDate);
    dayDate.setDate(dayDate.getDate() + section.dayNum - 1);

    const activities: Activity[] = [];

    // Find places mentioned in this section
    const sectionLower = section.content.toLowerCase();

    for (const place of places) {
      const placeLower = place.title.toLowerCase();

      // Check if this place is mentioned in this day's section
      if (sectionLower.includes(placeLower) || sectionLower.includes(placeLower.split(" ")[0])) {
        // Determine time slot
        let timeSlot = "morning";
        let startTime = "10:00";
        const placeContext = section.content.substring(
          Math.max(0, sectionLower.indexOf(placeLower) - 100),
          sectionLower.indexOf(placeLower) + placeLower.length + 100
        );

        for (const ts of timeSlotPatterns) {
          if (ts.patterns.some((p) => p.test(placeContext))) {
            timeSlot = ts.slot;
            if (ts.slot === "morning") startTime = "10:00";
            else if (ts.slot === "afternoon") startTime = "14:00";
            else startTime = "19:00";
            break;
          }
        }

        // Determine activity type
        let activityType = "attraction";
        for (const [type, patterns] of Object.entries(typePatterns)) {
          if (patterns.some((p) => p.test(place.title) || p.test(placeContext))) {
            activityType = type;
            break;
          }
        }

        // Avoid duplicates in same day
        if (activities.some((a) => a.name === place.title)) continue;

        activities.push({
          id: generateActivityId(),
          time_slot: timeSlot as "morning" | "afternoon" | "evening",
          start_time: startTime,
          duration_minutes: activityType === "restaurant" ? 90 : 120,
          name: place.title,
          type: activityType,
          description: `Visit ${place.title}`,
          location: params.destination,
          address: "",
          google_place_id: place.placeId,
          coordinates: undefined, // Will be fetched from Place Details if needed
          estimated_cost: {
            amount: 0,
            currency: "USD",
            tier: mapBudgetToTier(params.budgetTier),
          },
          tips: [],
          booking_required: false,
        });
      }
    }

    // Sort activities by time slot
    const slotOrder = { morning: 0, afternoon: 1, evening: 2 };
    activities.sort((a, b) => slotOrder[a.time_slot] - slotOrder[b.time_slot]);

    // Ensure we have at least some activities per day
    // If parsing didn't find enough, distribute remaining places
    if (activities.length < 2 && places.length > section.dayNum * 4) {
      const startIdx = (section.dayNum - 1) * 4;
      const dayPlaces = places.slice(startIdx, startIdx + 4);

      dayPlaces.forEach((place, idx) => {
        if (!activities.some((a) => a.name === place.title)) {
          const slots = ["morning", "afternoon", "afternoon", "evening"];
          const times = ["10:00", "12:30", "15:00", "19:00"];

          activities.push({
            id: generateActivityId(),
            time_slot: slots[idx] as "morning" | "afternoon" | "evening",
            start_time: times[idx],
            duration_minutes: idx === 1 || idx === 3 ? 90 : 120,
            name: place.title,
            type: idx === 1 || idx === 3 ? "restaurant" : "attraction",
            description: `Visit ${place.title}`,
            location: params.destination,
            address: "",
            google_place_id: place.placeId,
            coordinates: undefined,
            estimated_cost: {
              amount: 0,
              currency: "USD",
              tier: mapBudgetToTier(params.budgetTier),
            },
            tips: [],
            booking_required: false,
          });
        }
      });
    }

    // Extract theme from section content
    let theme = `Day ${section.dayNum} in ${params.destination}`;
    const themeMatch = section.content.match(/theme[:\s]+([^\n]+)/i) ||
                       section.content.match(/day\s*\d+[:\s-]+([^\n]+)/i);
    if (themeMatch) {
      theme = themeMatch[1].trim().replace(/\*+/g, "");
    }

    days.push({
      day_number: section.dayNum,
      date: dayDate.toISOString().split("T")[0],
      theme,
      activities: activities.slice(0, 5), // Cap at 5 activities per day
    });
  }

  // If we couldn't parse days, create default structure
  if (days.length === 0) {
    console.warn("[MapsGrounding] Could not parse day structure, creating default");

    for (let d = 1; d <= duration; d++) {
      const dayDate = new Date(params.startDate);
      dayDate.setDate(dayDate.getDate() + d - 1);

      const startIdx = (d - 1) * 4;
      const dayPlaces = places.slice(startIdx, startIdx + 4);

      const activities: Activity[] = dayPlaces.map((place, idx) => ({
        id: generateActivityId(),
        time_slot: (["morning", "afternoon", "afternoon", "evening"][idx] || "afternoon") as
          | "morning"
          | "afternoon"
          | "evening",
        start_time: ["10:00", "12:30", "15:00", "19:00"][idx] || "14:00",
        duration_minutes: idx === 1 || idx === 3 ? 90 : 120,
        name: place.title,
        type: idx === 1 || idx === 3 ? "restaurant" : "attraction",
        description: `Visit ${place.title}`,
        location: params.destination,
        address: "",
        google_place_id: place.placeId,
        coordinates: undefined,
        estimated_cost: {
          amount: 0,
          currency: "USD",
          tier: mapBudgetToTier(params.budgetTier),
        },
        tips: [],
        booking_required: false,
      }));

      days.push({
        day_number: d,
        date: dayDate.toISOString().split("T")[0],
        theme: `Day ${d} in ${params.destination}`,
        activities,
      });
    }
  }

  return days;
}

/**
 * Generate a complete itinerary using Maps Grounding
 * Returns structured itinerary with verified Google Place IDs
 *
 * Cost: ~$0.025 per call (vs $0.78-1.70 for traditional approach)
 */
export async function generateItineraryWithMapsGrounding(
  params: TripCreationParams
): Promise<GeneratedItinerary> {
  console.log(`[MapsGrounding] Generating itinerary for ${params.destination}...`);

  // Call Maps Grounding API
  const grounded = await callMapsGrounding(params);

  console.log(
    `[MapsGrounding] Response: ${grounded.places.length} places, ${grounded.text.length} chars`
  );

  // Parse the grounded response into structured itinerary
  const days = parseGroundedItinerary(grounded.text, grounded.places, params);

  // Calculate total activities
  const totalActivities = days.reduce((sum, day) => sum + day.activities.length, 0);

  console.log(
    `[MapsGrounding] Parsed ${days.length} days with ${totalActivities} activities`
  );

  return {
    destination: {
      name: params.destination.split(",")[0],
      country: params.destination.split(",")[1]?.trim() || "",
      description: `A wonderful trip to ${params.destination}`,
      best_for: params.vibes || [],
      weather_note: "",
    },
    days,
    trip_summary: {
      total_estimated_cost: 0,
      currency: "USD",
      highlights: grounded.places.slice(0, 5).map((p) => p.title),
      packing_suggestions: [],
    },
    booking_links: {
      flights: [],
      hotels: [],
    },
    // Include grounding metadata for debugging/analytics
    _grounding: {
      totalPlaces: grounded.places.length,
      responseTimeMs: grounded.responseTimeMs,
      groundingSupports: grounded.groundingSupports,
      cost: 0.025,
    },
  } as GeneratedItinerary & { _grounding?: Record<string, unknown> };
}

/**
 * Check if Maps Grounding is available (API key configured)
 */
export function isMapsGroundingAvailable(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY;
}

/**
 * Get the estimated cost for a Maps Grounding call
 */
export function getMapsGroundingCost(): number {
  return 0.025;
}
