/**
 * Maps Grounding Test Endpoint
 *
 * Tests Google Gemini Maps Grounding for travel planning use cases.
 * This is a proof-of-concept to evaluate:
 * 1. Can it generate structured itineraries?
 * 2. Does it return usable place_ids?
 * 3. How well does it handle budget/vibe constraints?
 *
 * Cost: $0.025 per grounded request (500 free/day)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { isAdmin } from "@/lib/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const MAPS_GROUNDING_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface MapsGroundingRequest {
  destination: string;
  destinationCoordinates: { lat: number; lng: number };
  vibes: string[];
  budgetTier: "budget" | "moderate" | "luxury";
  days: number;
  testType?: "simple" | "structured" | "full";
}

interface GroundingChunk {
  maps?: {
    uri: string;
    title: string;
    placeId: string;
  };
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: Array<{
    segment: { startIndex: number; endIndex: number };
    groundingChunkIndices: number[];
  }>;
  googleMapsWidgetContextToken?: string;
}

// Test 1: Simple proximity query (what Maps grounding is designed for)
function buildSimpleQuery(req: MapsGroundingRequest): string {
  return `What are the best ${req.vibes.join(" and ")} restaurants and attractions in ${req.destination} for a ${req.budgetTier} budget? Include romantic dinner spots and cultural landmarks.`;
}

// Test 2: Structured output request (may not work well with grounding)
function buildStructuredQuery(req: MapsGroundingRequest): string {
  return `Create a ${req.days}-day travel itinerary for ${req.destination}.

Budget tier: ${req.budgetTier}
Vibes: ${req.vibes.join(", ")}

For each day, suggest:
- A morning activity or attraction
- A lunch restaurant
- An afternoon activity
- A dinner restaurant
- An evening activity (optional)

Format your response as a numbered list with clear place names that can be found on Google Maps.`;
}

// Test 3: JSON output request (most ambitious)
function buildJsonQuery(req: MapsGroundingRequest): string {
  return `Create a ${req.days}-day travel itinerary for ${req.destination}.

Requirements:
- Budget tier: ${req.budgetTier}
- Vibes: ${req.vibes.join(", ")}
- Include 4-5 activities per day
- Mix of attractions, restaurants, and experiences

IMPORTANT: Return your response as valid JSON matching this exact structure:
{
  "days": [
    {
      "day_number": 1,
      "activities": [
        {
          "name": "Exact place name from Google Maps",
          "type": "attraction|restaurant|activity|cafe|museum|landmark",
          "time_slot": "morning|afternoon|evening",
          "description": "Why this place fits the vibes",
          "estimated_duration_minutes": 90
        }
      ]
    }
  ]
}

Use ONLY real places that exist on Google Maps.`;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Admin-only endpoint for testing
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    if (!(await isAdmin(user.id))) {
      return errors.forbidden("Admin access required for testing");
    }

    if (!GEMINI_API_KEY) {
      return errors.internal("GOOGLE_AI_API_KEY not configured", "Maps Grounding Test");
    }

    const body: MapsGroundingRequest = await request.json();
    const {
      destination,
      destinationCoordinates,
      vibes = ["romantic", "cultural"],
      budgetTier = "moderate",
      days = 3,
      testType = "simple"
    } = body;

    if (!destination || !destinationCoordinates) {
      return errors.badRequest("destination and destinationCoordinates required");
    }

    // Select query type based on test
    let query: string;
    switch (testType) {
      case "structured":
        query = buildStructuredQuery(body);
        break;
      case "full":
        query = buildJsonQuery(body);
        break;
      default:
        query = buildSimpleQuery(body);
    }

    console.log(`[Maps Grounding Test] Type: ${testType}, Destination: ${destination}`);
    console.log(`[Maps Grounding Test] Query:`, query.substring(0, 200) + "...");

    // Make Maps grounding request
    const response = await fetch(`${MAPS_GROUNDING_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: query }]
          }
        ],
        tools: [
          {
            googleMaps: {}
          }
        ],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: destinationCoordinates.lat,
              longitude: destinationCoordinates.lng
            }
          }
        },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Maps Grounding Test] API error:`, errorText);
      return errors.serviceUnavailable(`Maps grounding API error: ${errorText}`);
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];

    if (!candidate) {
      return errors.internal("No response generated", "Maps Grounding Test");
    }

    const text = candidate.content?.parts?.[0]?.text || "";
    const groundingMetadata: GroundingMetadata = candidate.groundingMetadata || {};

    // Extract place information from grounding metadata
    const extractedPlaces = (groundingMetadata.groundingChunks || [])
      .filter(chunk => chunk.maps)
      .map(chunk => ({
        title: chunk.maps!.title,
        placeId: chunk.maps!.placeId,
        mapsUri: chunk.maps!.uri,
      }));

    // Attempt to parse JSON if test type was "full"
    let parsedJson = null;
    if (testType === "full") {
      try {
        // Try to extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.log(`[Maps Grounding Test] JSON parse failed:`, e);
      }
    }

    const elapsedMs = Date.now() - startTime;

    return apiSuccess({
      success: true,
      testType,
      destination,
      query: query.substring(0, 500) + (query.length > 500 ? "..." : ""),

      // Response analysis
      response: {
        text: text.substring(0, 2000) + (text.length > 2000 ? "..." : ""),
        fullTextLength: text.length,
      },

      // Places extracted from grounding
      groundingResults: {
        placesFound: extractedPlaces.length,
        places: extractedPlaces,
        hasWidgetToken: !!groundingMetadata.googleMapsWidgetContextToken,
        supportsCount: groundingMetadata.groundingSupports?.length || 0,
      },

      // JSON parsing result (for "full" test)
      jsonParseResult: parsedJson ? {
        success: true,
        daysCount: parsedJson.days?.length,
        activitiesCount: parsedJson.days?.reduce((sum: number, d: { activities?: unknown[] }) =>
          sum + (d.activities?.length || 0), 0),
        sample: parsedJson.days?.[0],
      } : testType === "full" ? { success: false, reason: "Could not parse JSON from response" } : null,

      // Performance
      metrics: {
        responseTimeMs: elapsedMs,
        estimatedCost: extractedPlaces.length > 0 ? 0.025 : 0, // Only charged if grounding was used
      },

      // Raw metadata for debugging
      _debug: {
        groundingMetadata,
        finishReason: candidate.finishReason,
      }
    });

  } catch (error) {
    console.error("[Maps Grounding Test] Error:", error);
    return errors.internal(
      `Test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "Maps Grounding Test"
    );
  }
}

// GET endpoint for quick health check
export async function GET() {
  return apiSuccess({
    endpoint: "/api/ai/maps-grounding-test",
    description: "Tests Google Gemini Maps Grounding for travel planning",
    usage: {
      method: "POST",
      requiredFields: ["destination", "destinationCoordinates"],
      optionalFields: ["vibes", "budgetTier", "days", "testType"],
      testTypes: {
        simple: "Basic proximity query (best for Maps grounding)",
        structured: "Numbered list itinerary",
        full: "JSON structured output (most ambitious)"
      }
    },
    example: {
      destination: "Paris",
      destinationCoordinates: { lat: 48.8566, lng: 2.3522 },
      vibes: ["romantic", "cultural"],
      budgetTier: "moderate",
      days: 3,
      testType: "simple"
    },
    costInfo: {
      perRequest: "$0.025",
      freeDaily: 500
    }
  });
}
