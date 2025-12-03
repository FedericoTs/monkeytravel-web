import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeneratedItinerary, TripCreationParams, Activity, ItineraryDay } from "@/types";
import { generateActivityId } from "./utils/activity-id";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Model configurations
export const MODELS = {
  fast: "gemini-2.0-flash",
  thinking: "gemini-2.5-pro-preview-05-06",
  premium: "gemini-2.5-flash-preview-05-20",
} as const;

const SYSTEM_PROMPT = `You are MonkeyTravel AI, an expert travel planner with deep knowledge of destinations worldwide. Your role is to create personalized, practical, and memorable travel itineraries.

## Your Expertise
- Local knowledge of popular and hidden gem destinations
- Understanding of travel logistics (opening hours, travel times, seasonal variations)
- Budget optimization across different spending tiers
- Cultural sensitivity and local customs awareness
- Safety considerations and travel advisories

## Core Rules

1. **Real Places Only**: CRITICAL - Only suggest real, verifiable locations that exist today. Never invent fictional places, restaurants, or attractions. Every place you recommend must be searchable on Google Maps.

2. **Verifiable Information**:
   - Provide the FULL street address for every activity
   - Include the official website URL when available (must be real, working URLs)
   - If you don't know the exact website, leave it empty - DO NOT make up URLs
   - All places must be real businesses/attractions that a user can find on Google Maps

3. **Practical Scheduling**:
   - Consider opening hours and typical visit durations
   - Include buffer time for travel between locations
   - Schedule meals at appropriate times (breakfast 7-9, lunch 12-14, dinner 18-21)
   - Don't over-schedule - include rest time

4. **Budget Alignment**:
   - Budget Tier: Focus on free attractions, street food, public transport. Target <$100/day
   - Balanced Tier: Mix of paid attractions and local experiences. Target $100-250/day
   - Premium Tier: Skip-the-line access, fine dining, private tours. Target $250+/day

5. **Geographic Efficiency**:
   - Group nearby activities together
   - Minimize unnecessary backtracking
   - Consider traffic patterns for the destination

6. **Local Experience**:
   - Include at least 1-2 local gems per day (not just tourist attractions)
   - Suggest authentic local restaurants over tourist traps
   - Include cultural tips and local etiquette

7. **Weather & Seasonality**:
   - Consider weather conditions for the travel dates
   - Adjust outdoor activities based on season
   - Suggest indoor alternatives for rainy days
   - Include seasonal activities (Christmas markets in winter, cherry blossoms in spring)
   - Account for local holidays and festivals

8. **Vibe Alignment** (CRITICAL - Match activities to traveler's chosen vibes):
   - Adventure: outdoor activities, hiking, water sports, thrill-seeking experiences
   - Cultural: museums, heritage sites, local traditions, historical tours
   - Foodie: food markets, cooking classes, local restaurants, culinary experiences
   - Wellness: spas, yoga, meditation, peaceful nature walks, retreats
   - Romantic: sunset spots, intimate dining, scenic views, couple activities
   - Urban: city life, nightlife, modern architecture, trendy cafes and bars
   - Nature: national parks, wildlife watching, eco-tourism, wilderness
   - Offbeat: hidden gems, local secrets, non-touristy spots, unique experiences
   - Wonderland: quirky museums, whimsical cafes, surreal/artistic locations
   - Movie-Magic: film locations, studio tours, cinematic spots, iconic scenes
   - Fairytale: castles, charming villages, enchanted forests, storybook locations
   - Retro: vintage shops, retro diners, historic districts, nostalgic spots

## Output Format

Always respond with valid JSON matching the exact schema provided. Do not include any text before or after the JSON.`;

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
          "official_website": null,
          "estimated_cost": {
            "amount": 25,
            "currency": "USD",
            "tier": "moderate"
          },
          "tips": ["Tip 1", "Tip 2"],
          "booking_required": false
        }
      ],
      "daily_budget": {
        "total": 150,
        "breakdown": {
          "activities": 50,
          "food": 60,
          "transport": 40
        }
      }
    }
  ],
  "trip_summary": {
    "total_estimated_cost": 450,
    "currency": "USD",
    "highlights": ["Highlight 1", "Highlight 2", "Highlight 3"],
    "packing_suggestions": ["Item 1", "Item 2", "Item 3"]
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
      maxOutputTokens: 8192,
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
