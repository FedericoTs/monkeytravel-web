import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeneratedItinerary, TripCreationParams } from "@/types";

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

## Output Format

Always respond with valid JSON matching the exact schema provided. Do not include any text before or after the JSON.`;

function buildUserPrompt(params: TripCreationParams): string {
  const duration =
    Math.ceil(
      (new Date(params.endDate).getTime() -
        new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

  return `Plan a ${duration}-day trip to ${params.destination}.

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
- Duration: ${duration} days
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace}

## Traveler Preferences
- Interests: ${params.interests.join(", ")}
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
      "date": "${params.startDate}",
      "theme": "Day theme (e.g., 'Historic Center')",
      "activities": [
        {
          "time_slot": "morning",
          "start_time": "09:00",
          "duration_minutes": 120,
          "name": "Activity Name (must be the real, official name)",
          "type": "attraction",
          "description": "What to do here",
          "location": "Neighborhood or area name",
          "address": "Full street address (e.g., 'Via del Corso 123, 00186 Rome, Italy')",
          "official_website": "https://example.com (only if you know the real URL, otherwise null)",
          "estimated_cost": {
            "amount": 25,
            "currency": "EUR",
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
    "currency": "EUR",
    "highlights": ["Highlight 1", "Highlight 2", "Highlight 3"],
    "packing_suggestions": ["Item 1", "Item 2", "Item 3"]
  },
  "booking_links": {
    "flights": [
      {"provider": "Skyscanner", "url": "https://www.skyscanner.com/transport/flights/nyc/${params.destination.split(",")[0].toLowerCase().replace(/\s+/g, "")}/${params.startDate}", "label": "Search flights on Skyscanner"},
      {"provider": "Google Flights", "url": "https://www.google.com/travel/flights?q=flights+to+${encodeURIComponent(params.destination)}", "label": "Search on Google Flights"}
    ],
    "hotels": [
      {"provider": "Booking.com", "url": "https://www.booking.com/searchresults.html?ss=${encodeURIComponent(params.destination)}&checkin=${params.startDate}&checkout=${params.endDate}", "label": "Find hotels on Booking.com"},
      {"provider": "Airbnb", "url": "https://www.airbnb.com/s/${encodeURIComponent(params.destination)}/homes?checkin=${params.startDate}&checkout=${params.endDate}", "label": "Browse Airbnb stays"}
    ]
  }
}

Important:
- Return ONLY the JSON object, no additional text or markdown
- Ensure all dates are in YYYY-MM-DD format
- Include 3-5 activities per day depending on pace
- Make sure activities flow logically through the day`;
}

export async function generateItinerary(
  params: TripCreationParams
): Promise<GeneratedItinerary> {
  const model = genAI.getGenerativeModel({
    model: MODELS.fast,
    generationConfig: {
      temperature: 1.0,
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
  const result = await chat.sendMessage(userPrompt);
  const response = result.response;
  const text = response.text();

  try {
    const itinerary = JSON.parse(text) as GeneratedItinerary;
    return itinerary;
  } catch {
    console.error("Failed to parse AI response:", text);
    throw new Error("Failed to generate valid itinerary");
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

  return { valid: true };
}
