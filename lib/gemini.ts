import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeneratedItinerary, TripCreationParams, Activity, ItineraryDay, UserProfilePreferences } from "@/types";
import { generateActivityId } from "./utils/activity-id";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Model configurations
export const MODELS = {
  fast: "gemini-2.0-flash",
  thinking: "gemini-2.5-pro-preview-05-06",
  premium: "gemini-2.5-flash-preview-05-20",
} as const;

// Optimized system prompt - reduced from ~2400 to ~1200 chars (50% reduction = ~$4000/year savings)
const SYSTEM_PROMPT = `You are MonkeyTravel AI, creating personalized travel itineraries.

## CRITICAL Rules
1. **Real Places Only**: All locations MUST be real and verifiable on Google Maps. Never invent places.
2. **Full Addresses**: Include complete street addresses for every activity.
3. **GPS Coordinates**: Include accurate latitude/longitude for EVERY activity. This is MANDATORY.
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
Return ONLY valid JSON matching the schema. No markdown or extra text.`;

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

function buildUserPrompt(params: TripCreationParams): string {
  const duration =
    Math.ceil(
      (new Date(params.endDate).getTime() -
        new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

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

  return `Plan a ${duration}-day trip to ${params.destination}.

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
- Duration: ${duration} days
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace}

${vibeSection}${seasonalSection}## Traveler Preferences
- Interests: ${params.interests.length > 0 ? params.interests.join(", ") : "general sightseeing"}
${params.requirements ? `- Special Requirements: ${params.requirements}` : ""}
${buildProfilePreferencesSection(params.profilePreferences)}

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
          "official_website": null,
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
5. For official_website, use null if unsure (do not make up URLs)
6. Activities should flow logically through each day`;
}

export async function generateItinerary(
  params: TripCreationParams,
  retryCount = 0
): Promise<GeneratedItinerary> {
  const MAX_RETRIES = 2;

  const model = genAI.getGenerativeModel({
    model: MODELS.fast,
    generationConfig: {
      temperature: retryCount > 0 ? 0.7 : 1.0, // Lower temperature on retry
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 5000, // Reduced from 8192 - avg response is 3500-4500 tokens
      responseMimeType: "application/json",
    },
  });

  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: SYSTEM_PROMPT }],
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

  const userPrompt = buildUserPrompt(params);

  try {
    const result = await chat.sendMessage(userPrompt);
    const response = result.response;
    const text = response.text();

    // Try to parse JSON
    try {
      const itinerary = JSON.parse(text) as GeneratedItinerary;

      // Validate required fields exist
      if (!itinerary.destination || !itinerary.days || itinerary.days.length === 0) {
        throw new Error("Invalid itinerary structure");
      }

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
        return generateItinerary(params, retryCount + 1);
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
      return generateItinerary(params, retryCount + 1);
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

const REGENERATE_SYSTEM_PROMPT = `You are MonkeyTravel AI. Generate a SINGLE replacement activity for a travel itinerary.

## Rules
1. **Real Places Only**: Only suggest real, verifiable locations that exist today. The place must be searchable on Google Maps.
2. **Avoid Duplicates**: Do not suggest any place already in the itinerary.
3. **Context Aware**: The replacement should fit the time slot and day theme.
4. **Verifiable**: Include full street address. Only include official_website if you're certain it's correct, otherwise use null.
5. **GPS Coordinates**: Include accurate latitude/longitude. This is MANDATORY.

## Output Format
Return ONLY a valid JSON object for a single activity. No markdown, no extra text.`;

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

  try {
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: REGENERATE_SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "Understood. I will generate a single replacement activity as valid JSON." }] },
        { role: "user", parts: [{ text: userPrompt }] },
      ],
    });

    const response = result.response;
    const text = response.text();

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
