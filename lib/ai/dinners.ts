/**
 * A plan is asked for lunch and dinner on every full day (lib/ai/trip-prompt.ts) and still leaves dinner out of
 * some: a family trip to Kyoto in the benchmark had none on any of its three full days. So each full day without an
 * evening meal gets one: a real restaurant near the day's last place, from one short question for all such days,
 * asked beside the closing-day question so the plan isn't slower. The answer goes in once the days are final, after
 * the place it was chosen near: half an hour after that place's visit ends, not before 18:30. A restaurant that
 * isn't a real place near it, one the plan already holds, or one that would start after 21:00 is left out, and the
 * day stays as it was.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { activityOf, held } from "@/lib/ai/must-dos";
import { nameTokens } from "@/lib/ai/assistant/saved-activities";
import { isMealStop } from "@/lib/trip/pace";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import { haversineKm } from "@/lib/map/geo";
import { formatMinutesToTime } from "@/lib/datetime/format";
import type { Activity, BudgetTier } from "@/types";

type Stop = Partial<Activity> & { name?: string; type?: string; start_time?: string; duration_minutes?: number };
type Day = { day_number?: number; date?: string; city?: string; activities?: Stop[] };

/** The earliest a dinner goes in, and the latest it may start. */
const EARLIEST = 18 * 60 + 30;
const LATEST = 21 * 60;
/** From the end of the day's last visit to dinner. */
const AFTER_MINUTES = 30;
const DINNER_MINUTES = 90;
/** How far from the place it was chosen near a dinner may be. */
const NEAR_KM = 5;
/** At most this many days in one question. */
const MAX_DAYS = 10;
/** At most this many of the plan's own places to eat named in the question. */
const MAX_TAKEN = 40;
const TIMEOUT_MS = 8000;

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A day without dinner: the place the dinner is chosen near, where it is, and when the day's visits end. */
export interface DinnerWanted {
  /** The day's last place with a time and a pin: dinner is looked for near it, and follows it. */
  after: string;
  at: { lat: number; lng: number };
  date: string;
  city: string;
}

const isEveningMeal = (stop: Stop) => isMealStop(stop) && (minutesOf(stop.start_time) ?? 0) >= 17 * 60;

/** The full days (not the plan's first or last) with no meal from 17:00, each with the place dinner goes after. */
export function daysWithoutDinner(days: Day[], destination: string): DinnerWanted[] {
  return days.flatMap((day, i) => {
    const stops = day.activities ?? [];
    if (i === 0 || i === days.length - 1 || !day.date || stops.length === 0 || stops.some(isEveningMeal)) return [];
    const last = [...stops]
      // Dinner goes near a place that is where its pin says: not the placeholder of a stop with no location.
      .filter((s) => s.name && minutesOf(s.start_time) !== null && s.type !== "transport" && isRealPoint(s.coordinates))
      .sort((a, b) => (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0))
      .at(-1);
    if (!last?.name || !last.coordinates) return [];
    return [{ after: last.name, at: { lat: last.coordinates.lat, lng: last.coordinates.lng }, date: day.date, city: day.city || destination }];
  }).slice(0, MAX_DAYS);
}

const PLACE: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    n: { type: SchemaType.INTEGER, description: "The day's number in the list" },
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
  properties: { dinners: { type: SchemaType.ARRAY, items: PLACE } },
  required: ["dinners"],
};

/** What the model answers: each dinner is checked before it goes in (withDinners). */
export interface DinnerAnswer {
  dinners?: Array<Record<string, unknown>>;
}

const BUDGET_WORDS: Record<BudgetTier, string> = {
  budget: "inexpensive, where locals eat",
  balanced: "mid-priced",
  premium: "a special, upscale",
};

/** The places to eat the plan holds already, once each: a dinner named again would be turned away (withDinners). */
export function placesToEat(days: Day[]): string[] {
  const names = new Map<string, string>();
  for (const stop of days.flatMap((day) => day.activities ?? [])) {
    const name = stop.name?.trim();
    if (name && isMealStop(stop) && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].slice(0, MAX_TAKEN);
}

type DinnerOptions = { budgetTier?: BudgetTier; diets?: string[]; language: SupportedLanguage; taken?: string[] };

/** The question: the evenings, where each day ends, the budget and diets, and the places the plan already eats at. */
export function dinnerQuestion(wanted: DinnerWanted[], opts: DinnerOptions): string {
  return [
    "Name one real restaurant for dinner on each of these evenings, within a short walk or ride of the place the day ends at, open for dinner on that date:",
    ...wanted.map((w, i) => `${i + 1}. ${w.city}, ${w.date}: the day ends at ${w.after} (${w.at.lat.toFixed(5)}, ${w.at.lng.toFixed(5)})`),
    "",
    `Each one ${BUDGET_WORDS[opts.budgetTier ?? "balanced"]}${opts.diets?.length ? `, with good choices for a ${opts.diets.join(" and ")} diet` : ""}, and a different restaurant each evening.`,
    ...(opts.taken?.length ? [`None the plan already has: ${opts.taken.join("; ")}.`] : []),
    `Write each name as Google Maps shows it, its exact coordinates, and the description (about 20 words: what to eat there and why) in ${LANGUAGE_NAMES[opts.language]}.`,
  ].join("\n");
}

/**
 * One dinner for each day without one, as the model sees them. No answer when there is nothing to ask, no key, or
 * the question fails or takes too long: the days then stay as they were.
 */
export async function askForDinners(wanted: DinnerWanted[], opts: DinnerOptions): Promise<{ answer: DinnerAnswer; costUsd: number }> {
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
    const result = await withTimeout(model.generateContent(dinnerQuestion(wanted, opts)), TIMEOUT_MS, "Dinners");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as DinnerAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[dinners] not asked:", err instanceof Error ? err.message : String(err));
    return { answer: {}, costUsd: 0 };
  }
}

/**
 * The days with each answered dinner after the place it was chosen near, wherever that place now is: half an hour
 * after its visit ends, not before 18:30, as a restaurant. Left out when it isn't a real place within 5 km of that
 * place, the plan already holds it, it would start after 21:00, or the day has an evening meal by now. Pure.
 */
export function withDinners<D extends Day>(days: D[], wanted: DinnerWanted[], answer: DinnerAnswer): { days: D[]; added: number } {
  let out = days;
  let added = 0;
  for (const entry of answer.dinners ?? []) {
    const want = typeof entry.n === "number" ? wanted[entry.n - 1] : undefined;
    if (!want) continue;
    const at = out.findIndex((d) => (d.activities ?? []).some((s) => s.name === want.after));
    if (at < 0 || (out[at].activities ?? []).some(isEveningMeal)) continue;
    const anchor = (out[at].activities ?? []).find((s) => s.name === want.after)!;
    const ends = (minutesOf(anchor.start_time) ?? 0) + (anchor.duration_minutes || 60);
    const start = Math.ceil(Math.max(EARLIEST, ends + AFTER_MINUTES) / 15) * 15;
    if (start > LATEST) continue;
    const cost = Number(entry.cost_per_person_usd);
    const activity = activityOf({
      ...entry,
      type: "restaurant",
      start_time: formatMinutesToTime(start),
      duration_minutes: DINNER_MINUTES,
      ...(Number.isFinite(cost) && cost > 0 ? { estimated_cost: { amount: Math.round(cost), currency: "USD", tier: "moderate" } } : {}),
    });
    if (!activity || !activity.coordinates || haversineKm(activity.coordinates, want.at) > NEAR_KM) continue;
    const names = out.flatMap((d) => d.activities ?? []).map((s) => nameTokens(s.name ?? ""));
    const words = nameTokens(activity.name);
    if (words.length === 0 || held(words, names)) continue;
    const dinner = { ...activity, type: "restaurant" } as Activity;
    out = out.map((d, i) =>
      i === at
        ? {
            ...d,
            activities: [...(d.activities ?? []), dinner].sort(
              (a, b) => (minutesOf(a.start_time) ?? 24 * 60) - (minutesOf(b.start_time) ?? 24 * 60)
            ),
          }
        : d
    );
    added++;
  }
  return { days: out, added };
}
