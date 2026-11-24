/**
 * Places a plan can't visit at all on its dates: closed for the season, or past a road, pass or trail that is shut
 * then (snow, monsoon). A mountain pass in December, a summer-only trek, a lake road shut until June. The closing
 * question (lib/ai/closing-days.ts) leaves seasons out on purpose: it asks about a place's own closing days. A place
 * found here counts as shut on every day of the trip, so the closing step's swap puts an open place in its stead.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { knownClosingFor } from "@/lib/ai/known-closings";
import type { ShutDates } from "@/lib/ai/closing-days";

type Stop = { name?: string; type?: string };
type Day = { date?: string; activities?: Stop[] };

/** Stops that don't close for a season: meals, rides, the hotel, shops and nights out. */
const NOT_ASKED = /restaur|caf[eé]|food|\bbar\b|transport|accommodation|hotel|lodging|shopping|nightlife/i;
/** At most this many places in one question. */
const MAX_PLACES = 40;
const TIMEOUT_MS = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const placeKey = (name: string) => name.trim().toLowerCase();

/** The plan's places that could be shut for a season, each once, in plan order. */
export function placesForTheSeason(days: Day[]): string[] {
  const places = new Map<string, string>();
  for (const day of days) {
    for (const stop of day.activities ?? []) {
      const name = stop.name?.trim();
      if (name && !NOT_ASKED.test(stop.type ?? "") && !places.has(placeKey(name))) places.set(placeKey(name), name);
    }
  }
  return [...places.values()].slice(0, MAX_PLACES);
}

/** The trip's dates, in order, each once. */
export function tripDates(days: Day[]): string[] {
  return [...new Set(days.map((day) => day.date ?? "").filter((date) => DATE.test(date)))].sort();
}

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: { shut: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } } },
  required: ["shut"],
};

/** The question, one numbered line a place. */
export function seasonQuestion(destination: string, places: string[], from: string, to: string): string {
  const when = from === to ? `on ${from}` : `at any time from ${from} to ${to}`;
  return [
    `Which of these places in ${destination} can't be visited ${when}, because they are closed for the season, or the road, pass or trail to them is shut then (snow, monsoon)? Give their numbers.`,
    "Leave out a place that is open on any of those days, even under snow or with shorter hours: a road or place open all year, and a slope or meadow open for skiing or sledging, are open. Leave out any you are not sure about.",
    ...places.map((place, i) => `${i + 1}. ${place}`),
  ].join("\n");
}

/**
 * The places, of those given, shut for the whole of `dates`, as lower-case names. None when there is nothing to ask,
 * no key, or the question fails or takes too long: the plan then stays as it was.
 */
export async function askSeasonalClosings(
  destination: string,
  places: string[],
  dates: string[]
): Promise<{ shut: Set<string>; costUsd: number }> {
  const shut = new Set<string>();
  if (places.length === 0 || dates.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { shut, costUsd: 0 };
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 512,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  try {
    const result = await withTimeout(model.generateContent(seasonQuestion(destination, places, dates[0], dates.at(-1)!)), TIMEOUT_MS, "Seasonal closings");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    const answer = JSON.parse(result.response.text()) as { shut?: unknown };
    for (const n of Array.isArray(answer.shut) ? answer.shut : []) {
      const place = typeof n === "number" ? places[n - 1] : undefined;
      if (place) shut.add(placeKey(place));
    }
    return { shut, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[seasonal-closings] not asked:", err instanceof Error ? err.message : String(err));
    return { shut: new Set(), costUsd: 0 };
  }
}

/**
 * `shutDates` with each place shut for the season shut on every date of the trip too. A place on the checked list
 * (lib/ai/known-closings.ts) is decided by it alone, as its closing days are.
 */
export function withSeasonalClosings(shutDates: ShutDates, shut: Set<string>, dates: string[], destination: string): ShutDates {
  const decided = [...shut].filter((place) => !knownClosingFor(place, destination));
  if (decided.length === 0 || dates.length === 0) return shutDates;
  const out = new Map(shutDates);
  for (const place of decided) out.set(place, [...new Set([...(out.get(place) ?? []), ...dates])].sort());
  return out;
}
