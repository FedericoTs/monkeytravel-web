/**
 * A plan can name the same restaurant on two days, more often the longer the
 * trip: a kaiseki house in Kyoto, a bún chả place in Hanoi, each twice. Each
 * later visit gets another real restaurant near the stop before it, at the
 * same time, from one short question for all of them, asked beside the
 * dinner question so the plan isn't slower. An answer that isn't a real place
 * near that stop, or one the plan already holds, is left out, and the repeat
 * stays. Cafés, bars and a hotel's breakfast are left alone: going back to
 * them is natural.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { activityOf, held } from "@/lib/ai/must-dos";
import { nameTokens } from "@/lib/ai/assistant/saved-activities";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import { haversineKm } from "@/lib/map/geo";
import type { Activity, BudgetTier } from "@/types";

type Stop = Partial<Activity> & { name?: string; type?: string; start_time?: string; duration_minutes?: number };
type Day = { day_number?: number; date?: string; city?: string; activities?: Stop[] };

/** How far from the place it was chosen near a replacement may be. */
const NEAR_KM = 5;
/** At most this many repeats in one question. */
const MAX_REPEATS = 10;
const TIMEOUT_MS = 8000;

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A restaurant the trip goes back to is a repeat; a hotel's breakfast isn't. */
const isRestaurant = (s: Stop) => (s.type === "restaurant" || s.type === "food") && !/\b(hotel|hostel|breakfast)\b/i.test(s.name ?? "");

/** The same place, written either way round: each name's words are all in the other's. */
const sameRestaurant = (a: string[], b: string[]) => held(a, [b]) && held(b, [a]);

/** A restaurant the plan visits again on a later day, and where another is looked for. */
export interface RepeatWanted {
  /** The repeated restaurant, as named on its later day. */
  name: string;
  date: string;
  /** Its time, kept by the restaurant that replaces it. */
  start_time: string;
  /** The stop before it with a pin, or the repeat itself when none comes before. */
  near: string;
  at: { lat: number; lng: number };
  city: string;
}

/** Each later day's visit to a restaurant the plan already visits on an earlier day. */
export function repeatedRestaurants(days: Day[], destination: string): RepeatWanted[] {
  const earlier: string[][] = [];
  const wanted: RepeatWanted[] = [];
  for (const day of days) {
    const stops = [...(day.activities ?? [])].sort((a, b) => (minutesOf(a.start_time) ?? 24 * 60) - (minutesOf(b.start_time) ?? 24 * 60));
    const today: string[][] = [];
    stops.forEach((stop, i) => {
      if (!isRestaurant(stop) || !stop.name) return;
      const words = nameTokens(stop.name);
      if (words.length === 0) return;
      today.push(words);
      if (!day.date || !stop.start_time || !earlier.some((w) => sameRestaurant(words, w))) return;
      const before = stops
        .slice(0, i)
        .reverse()
        .find((s) => s.name && s.type !== "transport" && isRealPoint(s.coordinates));
      const anchor = before ?? (isRealPoint(stop.coordinates) ? stop : undefined);
      if (!anchor?.name || !anchor.coordinates) return;
      wanted.push({
        name: stop.name,
        date: day.date,
        start_time: stop.start_time,
        near: anchor.name,
        at: { lat: anchor.coordinates.lat, lng: anchor.coordinates.lng },
        city: day.city || destination,
      });
    });
    earlier.push(...today);
  }
  return wanted.slice(0, MAX_REPEATS);
}

const PLACE: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    n: { type: SchemaType.INTEGER, description: "The meal's number in the list" },
    name: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING, description: "The neighbourhood" },
    coordinates: {
      type: SchemaType.OBJECT,
      properties: { lat: { type: SchemaType.NUMBER }, lng: { type: SchemaType.NUMBER } },
      required: ["lat", "lng"],
    },
    cost_per_person_usd: { type: SchemaType.NUMBER },
  },
  required: ["n", "name", "description", "location", "coordinates"],
};
const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: { replacements: { type: SchemaType.ARRAY, items: PLACE } },
  required: ["replacements"],
};

/** What the model answers: each replacement is checked before it goes in (withReplacements). */
export interface RepeatAnswer {
  replacements?: Array<Record<string, unknown>>;
}

const BUDGET_WORDS: Record<BudgetTier, string> = {
  budget: "inexpensive, where locals eat",
  balanced: "mid-priced",
  premium: "a special, upscale",
};

type RepeatOptions = { budgetTier?: BudgetTier; diets?: string[]; language: SupportedLanguage; taken?: string[] };

/** The question: each repeat's place, date and time, the budget and diets, and the places the plan already eats at. */
export function repeatQuestion(wanted: RepeatWanted[], opts: RepeatOptions): string {
  return [
    "This trip names the same restaurant on two days. Name one other real restaurant for each of these meals, within a short walk or ride of the place named, open at that time on that date:",
    ...wanted.map(
      (w, i) => `${i + 1}. ${w.city}, ${w.date} at ${w.start_time}, near ${w.near} (${w.at.lat.toFixed(5)}, ${w.at.lng.toFixed(5)}), instead of ${w.name}`
    ),
    "",
    `Each one ${BUDGET_WORDS[opts.budgetTier ?? "balanced"]}${opts.diets?.length ? `, with good choices for a ${opts.diets.join(" and ")} diet` : ""}, a local place rather than a fast-food chain, and a different restaurant each time.`,
    ...(opts.taken?.length ? [`None the plan already has: ${opts.taken.join("; ")}.`] : []),
    `Write each name as Google Maps shows it, its exact coordinates, and the description (about 20 words: what to eat there and why) in ${LANGUAGE_NAMES[opts.language]}.`,
  ].join("\n");
}

/**
 * Another restaurant for each repeat, as the model sees them. No answer when there is nothing to ask, no key, or the
 * question fails or takes too long: the repeats then stay.
 */
export async function askForReplacements(wanted: RepeatWanted[], opts: RepeatOptions): Promise<{ answer: RepeatAnswer; costUsd: number }> {
  if (wanted.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { answer: {}, costUsd: 0 };
  const modelName = getModelForPurpose("dinners");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 2048,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  try {
    const result = await withTimeout(model.generateContent(repeatQuestion(wanted, opts)), TIMEOUT_MS, "Repeated restaurants");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as RepeatAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[repeated-meals] not asked:", err instanceof Error ? err.message : String(err));
    return { answer: {}, costUsd: 0 };
  }
}

/**
 * The days with each answered restaurant in its repeat's place, at the repeat's time and length. Left out when it
 * isn't a real place within 5 km of the place it was chosen near, the plan already holds it, or the repeat is gone
 * from its day by now. Pure.
 */
export function withReplacements<D extends Day>(days: D[], wanted: RepeatWanted[], answer: RepeatAnswer): { days: D[]; replaced: number } {
  let out = days;
  let replaced = 0;
  for (const entry of answer.replacements ?? []) {
    const want = typeof entry.n === "number" ? wanted[entry.n - 1] : undefined;
    if (!want) continue;
    const at = out.findIndex((d) => d.date === want.date);
    const index = at < 0 ? -1 : (out[at].activities ?? []).findIndex((s) => s.name === want.name && s.start_time === want.start_time);
    if (index < 0) continue;
    const repeat = out[at].activities![index];
    const cost = Number(entry.cost_per_person_usd);
    const activity = activityOf({
      ...entry,
      type: "restaurant",
      start_time: want.start_time,
      duration_minutes: repeat.duration_minutes || 90,
      ...(Number.isFinite(cost) && cost > 0 ? { estimated_cost: { amount: Math.round(cost), currency: "USD", tier: "moderate" } } : {}),
    });
    if (!activity || !activity.coordinates || haversineKm(activity.coordinates, want.at) > NEAR_KM) continue;
    const names = out.flatMap((d) => d.activities ?? []).map((s) => nameTokens(s.name ?? ""));
    const words = nameTokens(activity.name);
    if (words.length === 0 || held(words, names)) continue;
    const restaurant = { ...activity, type: "restaurant" } as Activity;
    out = out.map((d, i) => (i === at ? { ...d, activities: (d.activities ?? []).map((s, j) => (j === index ? restaurant : s)) } : d));
    replaced++;
  }
  return { days: out, replaced };
}
