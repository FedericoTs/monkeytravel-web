/**
 * AI-generated packing list for a trip.
 *
 * Lightweight Gemini Flash call with strict JSON output. Cheap (~$0.0002
 * per request, no images), fast (<3s), and free for users — designed as
 * a lead-magnet tool that captures emails before exporting the PDF.
 *
 * Distinct from the main trip-itinerary generator on a few axes:
 *   - No grounding / Maps API → pure model output, no external cost
 *   - No streaming → single short response
 *   - Small/cheap model (gemini-2.5-flash-lite) — packing lists don't
 *     need the smarter model
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

export interface PackingListInput {
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  travelStyle:
    | "city"
    | "beach"
    | "adventure"
    | "business"
    | "wellness"
    | "mixed";
  activities?: string[]; // optional checklist like ["hiking", "swimming", "fine_dining"]
  /** Locale for output text (en/it/es). Falls back to en. */
  locale?: "en" | "it" | "es";
}

export interface PackingItem {
  name: string;
  /** Optional short note ("for evening dinners", "Type C/F outlet") */
  note?: string;
  /** True for items that frequently get forgotten — surface in UI */
  essential?: boolean;
}

export interface PackingListResult {
  categories: Array<{
    /** Stable English key for the category — UI maps to localized label */
    id:
      | "documents"
      | "clothing"
      | "toiletries"
      | "electronics"
      | "activity_gear"
      | "health"
      | "misc";
    items: PackingItem[];
  }>;
  /** One-liner sourced from the prompt: weather summary + key local notes */
  contextNote: string;
}

const LOCALE_NAME: Record<NonNullable<PackingListInput["locale"]>, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
};

function buildPrompt(input: PackingListInput): string {
  const days =
    Math.ceil(
      (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;
  const language = LOCALE_NAME[input.locale || "en"];
  const activities = (input.activities || []).join(", ") || "general sightseeing";

  return `You are an experienced travel writer who has packed for hundreds of trips.
Generate a personalized packing list as STRICT JSON (no markdown, no extra text).

Trip details:
- Destination: ${input.destination}
- Travel dates: ${input.startDate} to ${input.endDate} (${days} day${days === 1 ? "" : "s"})
- Travel style: ${input.travelStyle}
- Planned activities: ${activities}

Output language: ${language}.

Return this exact JSON shape:
{
  "categories": [
    {
      "id": "documents" | "clothing" | "toiletries" | "electronics" | "activity_gear" | "health" | "misc",
      "items": [
        { "name": "Passport", "note": "Check 6-month validity", "essential": true }
      ]
    }
  ],
  "contextNote": "One-sentence summary of weather + key local notes (e.g., 'Late May in Tokyo: 18-25°C, plug Type A, modest dress for temples.')"
}

Rules:
1. JSON only. No \`\`\`, no prose around it.
2. Include 6 categories in this order: documents, clothing, toiletries, electronics, activity_gear, health.
   Add "misc" only if you have items that don't fit the other 6.
3. Each category: 4-10 items. Tailor item count to trip length (3-day weekender = lean,
   14-day backpacking = more items). Account for laundry on longer trips.
4. Tailor to the destination:
   - Plug/outlet type for that country (Type A/B/C/F/G/I, voltage)
   - Climate-specific layers (rainy/cold/hot/humid/dry)
   - Cultural notes (e.g., modest clothing for temples in Bali, evening jacket in Paris)
   - Local pharmacy availability — flag must-bring meds vs locally available
5. Mark items \`essential: true\` ONLY for items that:
   - Are commonly forgotten (passport, charger, prescription meds), OR
   - Are hard to source at the destination, OR
   - Are critical for the planned activities (hiking boots for a hiking trip)
6. Notes are optional. Use them when they add real value (size, plug type, "for X scenario"),
   not just to repeat the name. Keep notes under 60 characters.
7. All user-visible text must be in ${language}. The "id" keys stay in English.
8. NEVER include items that would be illegal or controlled substances at the destination.
   If the destination has unusual restrictions (e.g., medication imports), add a note in
   contextNote.`;
}

/**
 * Call Gemini Flash for a personalized packing list. Returns parsed JSON
 * or throws if the model output is malformed.
 */
export async function generatePackingList(
  input: PackingListInput
): Promise<PackingListResult> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
      temperature: 0.4, // Slightly creative for personality but mostly deterministic
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
    },
  });

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
  });

  const raw = response.response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned non-JSON output");
  }

  // Validate shape — we don't need exhaustive checks, just enough to
  // catch obvious model failures.
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Record<string, unknown>).categories)
  ) {
    throw new Error("Gemini output missing categories array");
  }

  return parsed as PackingListResult;
}
