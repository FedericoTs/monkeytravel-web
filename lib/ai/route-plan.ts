/**
 * Where a trip to a whole country or region sleeps. Someone who types
 * "Thailand" for two weeks moves between a few bases, and one place's plan
 * can't: it fills the days from one centre, or jumps across the country with
 * no ride between. One short question answers the bases in order with their
 * days, the usual way for that length and season; a city, an island or a place
 * seen from one base comes back alone, and nothing is offered. Step 1 offers
 * the route (app/api/wizard/route-plan), and the trip is then planned through
 * those cities like any other trip through several.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { readRoute, type RouteStop } from "@/lib/ai/assistant/route";
import { MAX_CITIES } from "@/lib/ai/multi-city-core";
import { isSameDestination } from "@/lib/trips/sameDestination";
import { ROUTE_STOP_NIGHTS_MAX } from "@/lib/trips/request-limits";

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    stops: {
      type: SchemaType.ARRAY,
      // No more bases than a trip through several cities takes (readRoute turns a longer list down whole).
      maxItems: String(MAX_CITIES),
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          country: { type: SchemaType.STRING },
          days: { type: SchemaType.INTEGER },
        },
        required: ["name", "country", "days"],
      },
    },
  },
  required: ["stops"],
};

const TIMEOUT_MS = 8000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The question: the place as typed, the trip's length and, when known, its month. */
export function routeQuestion(place: string, days: number, month: number | null, language: SupportedLanguage): string {
  const when = month && month >= 1 && month <= 12 ? `, in ${MONTHS[month - 1]}` : "";
  return [
    `Someone is planning a trip of ${days} days to "${place}"${when}, and wants to know where to sleep.`,
    "Answer the bases they'd stay in, in order, each with its days:",
    `- When it is one city, town, island, resort or park that travellers see from one base in ${days} days, answer it alone, with all ${days} days.`,
    "- When it names several places, they are the bases, in its order.",
    `- Otherwise it is a country or a region: answer the 2 to 5 bases most travellers use for ${days} days there, in the order they'd go, right for that season. No going back and forth, at least 2 days and at most ${ROUTE_STOP_NIGHTS_MAX} in each.`,
    `- The days add up to ${days}. Each base is a city, town or island, named as Google Maps names it in ${LANGUAGE_NAMES[language]}, with its country.`,
  ].join("\n");
}

/**
 * The bases as the model answers them. No answer when there is no key, or the
 * question fails or takes too long: step 1 then offers nothing.
 */
export async function askForRoute(
  place: string,
  days: number,
  month: number | null,
  language: SupportedLanguage,
  timeoutMs = TIMEOUT_MS
): Promise<{ answer: unknown; costUsd: number }> {
  if (!process.env.GOOGLE_AI_API_KEY) return { answer: null, costUsd: 0 };
  const modelName = getModelForPurpose("route-plan");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 1024,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  try {
    const result = await withTimeout(model.generateContent(routeQuestion(place, days, month, language)), timeoutMs, "Route");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as unknown, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[route-plan] no route:", err instanceof Error ? err.message : String(err));
    return { answer: null, costUsd: 0 };
  }
}

/**
 * The route step 1 can offer: two to five bases the planner would accept, their
 * days adding up to the trip's (readRoute). None for one base, or when a base is
 * the typed place itself ("Thailand" for Thailand), which isn't a route through it.
 */
export function routeFor(answer: unknown, place: string, days: number): RouteStop[] {
  const raw = answer && typeof answer === "object" ? (answer as { stops?: unknown }).stops : undefined;
  const stops = readRoute(raw, days, [{ name: place, days }]);
  const onePlace = !/[,&]/.test(place);
  if (onePlace && stops.some((s) => isSameDestination(s.name, place))) return [];
  return stops;
}
