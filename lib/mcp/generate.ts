/**
 * MCP Trip Generation
 * Wrapper around existing Gemini infrastructure for MCP
 *
 * IMPORTANT: This is a NEW file - reuses but does not modify existing code
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  GenerateTripInput,
  MCPTripResponse,
  MCPDay,
  MCPActivity,
} from "./schema";

// Initialize Gemini (same pattern as lib/gemini.ts)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/**
 * Generate a trip itinerary for MCP/ChatGPT
 * Uses Gemini 2.5 Flash for fast, cost-effective generation
 */
export async function generateMCPTrip(
  input: GenerateTripInput
): Promise<MCPTripResponse> {
  const startTime = Date.now();

  // Build prompt
  const prompt = buildMCPPrompt(input);

  // Use Gemini 2.5 Flash for MCP (fast & cheap)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse JSON response
    const itinerary = JSON.parse(text) as { days: MCPDay[] };

    // Generate trip ID
    const tripId = crypto.randomUUID();

    // Build response
    const mcpResponse: MCPTripResponse = {
      id: tripId,
      destination: input.destination,
      days: input.days,
      itinerary: itinerary.days,
      summary: `Your ${input.days}-day ${input.destination} itinerary is ready! Includes ${countActivities(itinerary.days)} activities across ${input.days} days.`,
      saveUrl: buildSaveUrl(input, tripId),
    };

    // Log for debugging (will be visible in Vercel logs)
    console.log("[MCP Generate]", {
      destination: input.destination,
      days: input.days,
      duration: Date.now() - startTime,
      activitiesCount: countActivities(itinerary.days),
    });

    return mcpResponse;
  } catch (error) {
    console.error("[MCP Generate Error]", error);
    throw new Error(
      `Failed to generate itinerary: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Build prompt for Gemini
 */
function buildMCPPrompt(input: GenerateTripInput): string {
  let prompt = `Create a ${input.days}-day travel itinerary for ${input.destination}.`;

  if (input.travel_style) {
    prompt += ` The trip should be ${input.travel_style}-focused.`;
  }

  if (input.interests?.length) {
    prompt += ` Key interests: ${input.interests.join(", ")}.`;
  }

  if (input.budget) {
    prompt += ` Budget level: ${input.budget}.`;
  }

  prompt += `

For each day, provide:
1. A theme or focus for the day
2. 4-5 activities with specific times
3. Mix of attractions, food, and experiences
4. Local insider tips

Return ONLY valid JSON matching this exact structure:
{
  "days": [
    {
      "day": 1,
      "theme": "Historic Center Exploration",
      "activities": [
        {
          "name": "Colosseum Visit",
          "time": "09:00-11:30",
          "type": "attraction",
          "description": "Explore Rome's iconic amphitheater",
          "location": "Piazza del Colosseo",
          "tip": "Book skip-the-line tickets in advance"
        }
      ]
    }
  ]
}

Important:
- Use realistic times (e.g., "09:00-11:00", "12:30-14:00")
- Include restaurants for lunch and dinner
- Each day should have 4-5 activities
- Keep descriptions concise (1-2 sentences)
- Add practical tips when relevant`;

  return prompt;
}

/**
 * Build save URL for MonkeyTravel app
 */
function buildSaveUrl(input: GenerateTripInput, tripId: string): string {
  const params = new URLSearchParams({
    destination: input.destination,
    days: String(input.days),
    source: "chatgpt",
    ref: tripId,
  });

  if (input.travel_style) {
    params.set("style", input.travel_style);
  }

  return `https://monkeytravel.app/trip/new?${params.toString()}`;
}

/**
 * Count total activities across all days
 */
function countActivities(days: MCPDay[]): number {
  return days.reduce((total, day) => total + day.activities.length, 0);
}
