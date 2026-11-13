/**
 * Whether a message tells a trip through several cities its route anew ("we go
 * back to Lisbon on the 27th", "the last 3 days back in Lisbon"), read by one
 * short question of its own, beside the edit engine's: which city each day of
 * the trip is in. Day by day is a narrow, mechanical answer that keeps the days
 * the message doesn't change; the stops are made from it here, and checked by
 * readRoute before anything is offered. Any failure reads as no new route.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, resolveAiLanguage } from "@/lib/ai/language";
import { addIsoDays } from "@/lib/dates/iso-date";
import { isSameDestination } from "@/lib/trips/sameDestination";
import type { ItineraryDay } from "@/types";
import { note } from "./notes";
import { planRoute, readRoute, type RouteStop } from "./route";

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: { days: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } } },
  required: ["days"],
};

const TIMEOUT_MS = 8000;

/** What the planner reads with a new route on offer: each stop with its days, then the button's promise. */
export function routeOfferReply(language: string | undefined, route: RouteStop[]): string {
  const stops = route.map((s) => note(language, "routeStop", { name: s.name, days: s.days })).join(" → ");
  return note(language, "routeOffer", { route: stops });
}

/** The plan day by day: each day with its date and city. */
export function planDays(days: ItineraryDay[], startDate?: string): string[] {
  return days.map((d, i) => {
    const date = d.date || (startDate ? addIsoDays(startDate, i) : null);
    return `Day ${i + 1}${date ? ` (${date})` : ""}: ${(d.city ?? "").trim() || "?"}`;
  });
}

/** The question, with each day's date so "back on the 27th" can be counted. */
export function routeQuestion(message: string, days: ItineraryDay[], startDate?: string, language?: string): string {
  const names = LANGUAGE_NAMES[resolveAiLanguage(language)];
  return [
    `A traveller is talking to their trip planner about a trip of ${days.length} days through several cities. The city each day is in now:`,
    ...planDays(days, startDate),
    "",
    "Their message:",
    '"""',
    message,
    '"""',
    "",
    "Does the message tell a different route for the trip: days moved from one city to another, a return to a city, another order, or a city added or dropped? What to do inside the cities (sights, meals, times, a day trip and back) is not a new route, and neither is a question.",
    `If it does, give the city every day should be in, from day 1 to day ${days.length}, in order, one entry per day, each as "City, Country". Keep a day's city exactly as written above when the message doesn't change it. A day they travel is in the city they arrive in. Name a new city as Google Maps names it in ${names}. If it doesn't, give no days.`,
  ].join("\n");
}

/** The stops of a day-by-day answer ("Lisboa, Portugal" each day), or null when it isn't one entry per day. */
export function stopsOfDays(answer: unknown, length: number): Array<{ name: string; country: string; days: number }> | null {
  if (!Array.isArray(answer) || answer.length !== length) return null;
  const stops: Array<{ name: string; country: string; days: number }> = [];
  for (const entry of answer) {
    if (typeof entry !== "string" || !entry.trim()) return null;
    const parts = entry.split(",").map((p) => p.trim()).filter(Boolean);
    const name = parts[0] ?? "";
    const country = parts.length > 1 ? parts[parts.length - 1] : "";
    const last = stops[stops.length - 1];
    if (last && isSameDestination(last.name, name)) last.days++;
    else stops.push({ name, country, days: 1 });
  }
  return stops;
}

/**
 * The new route the message tells, checked, or none: also with no key, or when
 * the question fails or takes too long.
 */
export async function askForRoute(
  input: { message: string; days: ItineraryDay[]; startDate?: string; locale?: string },
  timeoutMs = TIMEOUT_MS,
): Promise<{ route: RouteStop[]; costUsd: number }> {
  if (!process.env.GOOGLE_AI_API_KEY) return { route: [], costUsd: 0 };
  const modelName = getModelForPurpose("request-reading");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 1024,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  try {
    const result = await withTimeout(
      model.generateContent(routeQuestion(input.message, input.days, input.startDate, input.locale)),
      timeoutMs,
      "Route",
    );
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    const answer = JSON.parse(result.response.text()) as { days?: unknown };
    const stops = stopsOfDays(answer.days, input.days.length);
    return { route: stops ? readRoute(stops, input.days.length, planRoute(input.days)) : [], costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[route-reading] not read:", err instanceof Error ? err.message : String(err));
    return { route: [], costUsd: 0 };
  }
}
