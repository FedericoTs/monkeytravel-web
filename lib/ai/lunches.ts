/**
 * A plan is asked for lunch on every full day (lib/ai/trip-prompt.ts) and still leaves it out of some: a day goes
 * from a morning sight to an afternoon one with nothing to eat between. So each full day without a midday meal gets
 * one: a real restaurant a short walk from the visit before it, from one short question for all such days, asked
 * while the days are settled so the plan isn't slower. It goes in twenty minutes after that visit ends, from noon and
 * by half past two, and the day's later stops move on to make room as for any stop put in (lib/trip/day-room.ts):
 * never a sight past the afternoon, a booked stop or a dated event. A restaurant that isn't a real place near that
 * visit, or one the plan already holds, is left out, and the day stays as it was. A day that eats at a food market at
 * midday, or spends it on one long visit (a day trip, a theme park), has its lunch; the first and last days and a day
 * with a ride are left as they are.
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
import { isRide } from "@/lib/trip/far-pins";
import { withStopAt } from "@/lib/trip/day-room";
import { haversineKm } from "@/lib/map/geo";
import { formatMinutesToTime } from "@/lib/datetime/format";
import type { Activity, BudgetTier } from "@/types";

type Stop = Partial<Activity> & { name?: string; type?: string; start_time?: string; duration_minutes?: number; locked?: boolean };
type Day = { day_number?: number; date?: string; city?: string; activities?: Stop[] };

/** A meal by three that is still on at half past eleven is lunch: a brunch, a lunch, a late lunch. */
const MEAL_BY = 15 * 60;
const MEAL_ON_AT = 11 * 60 + 30;
/** A food market, hall or tour by half past two that is still on at noon is where the day eats. */
const FOOD_PLACE = /\bmarket|mercad|mercat|march[eé]|hawker|\bfood\b/i;
const FOOD_PLACE_BY = 14 * 60 + 30;
/** One visit from noon to two (a day trip, a theme park) has its lunch there. */
const NOON = 12 * 60;
const TWO = 14 * 60;
/** The earliest a lunch goes in, the hour it is best at, and the latest it may start. */
const EARLIEST = 12 * 60;
const BEST = 13 * 60;
const LATEST = 14 * 60 + 30;
/** From the end of the visit before it to lunch: the walk lib/trip/day-room.ts leaves between stops. */
const AFTER_MINUTES = 20;
const LUNCH_MINUTES = 60;
/** A visit's length when the plan gives none, as lib/trip/day-room.ts counts it. */
const DEFAULT_MINUTES = 90;
/** How far from the visit before it a lunch may be. */
const NEAR_KM = 3;
/** At most this many days in one question. */
const MAX_DAYS = 10;
const TIMEOUT_MS = 8000;
/** Asked twice at once, as dinners are (lib/ai/dinners.ts): a second answer fills days the first couldn't. */
const ASKS = 2;

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const endOf = (stop: Stop, start: number) => start + (stop.duration_minutes || DEFAULT_MINUTES);
const byTime = (stops: Stop[]) => [...stops].sort((a, b) => (minutesOf(a.start_time) ?? 24 * 60) - (minutesOf(b.start_time) ?? 24 * 60));

/** Whether a day eats at midday: a meal around then, a food market by half past two, or one visit from noon to two. */
function eatsAtMidday(stops: Stop[]): boolean {
  return stops.some((stop) => {
    const start = minutesOf(stop.start_time);
    if (start === null) return false;
    if (isMealStop(stop)) return start <= MEAL_BY && endOf(stop, start) > MEAL_ON_AT;
    if (FOOD_PLACE.test(`${stop.name ?? ""} ${stop.type ?? ""}`) && start <= FOOD_PLACE_BY && endOf(stop, start) > NOON) return true;
    return start <= NOON && endOf(stop, start) >= TWO;
  });
}

/** When lunch would start after a visit: twenty minutes after it ends, from noon, in whole quarter hours. None after half past two. */
function lunchAfter(visit: Stop): number | null {
  const start = minutesOf(visit.start_time);
  if (start === null) return null;
  const time = Math.ceil(Math.max(EARLIEST, endOf(visit, start) + AFTER_MINUTES) / 15) * 15;
  return time <= LATEST ? time : null;
}

/**
 * The day with `lunch` right after `visit`, its later stops moved on to make room (lib/trip/day-room.ts). Null when
 * another stop starts between that visit and lunch, a sight would leave the afternoon, or a booked stop or a dated
 * event would move.
 */
function withLunchAfter<D extends Day>(day: D, visit: Stop, lunch: Stop): D | null {
  const order = byTime(day.activities ?? []);
  const at = order.indexOf(visit);
  const lunchStarts = minutesOf(lunch.start_time);
  if (at < 0 || lunchStarts === null) return null;
  const nextStarts = minutesOf(order[at + 1]?.start_time);
  if (nextStarts !== null && nextStarts < lunchStarts) return null;
  const made = withStopAt({ ...day, activities: order }, lunch, { keepShape: true }, at + 1);
  if (!made) return null;
  const kept = new Set(order);
  return (made.activities ?? []).some((stop) => stop.locked && !kept.has(stop)) ? null : made;
}

const lunchAt = (time: number): Stop => ({ name: "Lunch", type: "restaurant", start_time: formatMinutesToTime(time), duration_minutes: LUNCH_MINUTES });

/** A day without lunch: the visit lunch follows, where it is, and when lunch starts after it. */
export interface LunchWanted {
  /** The visit lunch follows: it is looked for near it. */
  after: string;
  at: { lat: number; lng: number };
  date: string;
  city: string;
  time: string;
}

/**
 * The full days (not the plan's first or last, nor one with a ride) that don't eat at midday, each with the visit
 * lunch follows: of those that leave room for it, the one it comes nearest one o'clock after.
 */
export function daysWithoutLunch(days: Day[], destination: string): LunchWanted[] {
  return days
    .flatMap((day, i) => {
      const stops = day.activities ?? [];
      if (i === 0 || i === days.length - 1 || !day.date || stops.length === 0 || stops.some(isRide) || eatsAtMidday(stops)) return [];
      const fits = stops
        .filter((stop) => stop.name && !isMealStop(stop) && isRealPoint(stop.coordinates))
        .map((stop) => ({ stop, time: lunchAfter(stop) }))
        .filter((choice): choice is { stop: Stop; time: number } => choice.time !== null)
        .sort((a, b) => Math.abs(a.time - BEST) - Math.abs(b.time - BEST) || a.time - b.time)
        .find(({ stop, time }) => withLunchAfter(day, stop, lunchAt(time)) !== null);
      if (!fits?.stop.name || !isRealPoint(fits.stop.coordinates)) return [];
      const { lat, lng } = fits.stop.coordinates;
      return [{ after: fits.stop.name, at: { lat, lng }, date: day.date, city: day.city || destination, time: formatMinutesToTime(fits.time) }];
    })
    .slice(0, MAX_DAYS);
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
  properties: { lunches: { type: SchemaType.ARRAY, items: PLACE } },
  required: ["lunches"],
};

/** What the model answers: each lunch is checked before it goes in (withLunches). */
export interface LunchAnswer {
  lunches?: Array<Record<string, unknown>>;
}

const BUDGET_WORDS: Record<BudgetTier, string> = {
  budget: "inexpensive, where locals eat",
  balanced: "mid-priced",
  premium: "upscale",
};

type LunchOptions = { budgetTier?: BudgetTier; diets?: string[]; language: SupportedLanguage; taken?: string[] };

/** The question: each day's visit, where it is and when lunch starts, the budget and diets, and the places the plan eats at. */
export function lunchQuestion(wanted: LunchWanted[], opts: LunchOptions): string {
  return [
    "Name one real restaurant for lunch on each of these days, a short walk from the place visited just before it, open for lunch at that time on that date:",
    ...wanted.map((w, i) => `${i + 1}. ${w.city}, ${w.date}: lunch at ${w.time}, after ${w.after} (${w.at.lat.toFixed(5)}, ${w.at.lng.toFixed(5)})`),
    "",
    `Each one ${BUDGET_WORDS[opts.budgetTier ?? "balanced"]}${opts.diets?.length ? `, with good choices for a ${opts.diets.join(" and ")} diet` : ""}: a local place rather than a fast-food chain, and a different restaurant each day.`,
    ...(opts.taken?.length ? [`None the plan already has: ${opts.taken.join("; ")}.`] : []),
    `Write each name as Google Maps shows it, its exact coordinates, and the description (about 20 words: what to eat there and why) in ${LANGUAGE_NAMES[opts.language]}.`,
  ].join("\n");
}

/**
 * Lunches for the days without one, as the model sees them: every answer's, the first answer's first, so a later
 * answer's lunch goes in only on a day the earlier ones couldn't fill (withLunches). No answer when there is nothing
 * to ask, no key, or every question fails or takes too long: the days then stay as they were.
 */
export async function askForLunches(wanted: LunchWanted[], opts: LunchOptions): Promise<{ answer: LunchAnswer; costUsd: number }> {
  if (wanted.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { answer: {}, costUsd: 0 };
  // The dinners' model: the plans' own, which knows the places to eat.
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
  const question = lunchQuestion(wanted, opts);
  const askOnce = async (): Promise<{ answer: LunchAnswer; costUsd: number }> => {
    try {
      const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Lunches");
      const usage = result.response.usageMetadata;
      recordGeminiUsage(modelName, usage);
      return { answer: JSON.parse(result.response.text()) as LunchAnswer, costUsd: geminiCostUsd(modelName, usage) };
    } catch (err) {
      console.warn("[lunches] not asked:", err instanceof Error ? err.message : String(err));
      return { answer: {}, costUsd: 0 };
    }
  };
  const answers = await Promise.all(Array.from({ length: ASKS }, askOnce));
  return {
    answer: { lunches: answers.flatMap((a) => (Array.isArray(a.answer.lunches) ? a.answer.lunches : [])) },
    costUsd: answers.reduce((sum, a) => sum + a.costUsd, 0),
  };
}

/**
 * The days with each answered lunch right after the visit it was chosen near, wherever that visit now is: twenty
 * minutes after it ends, from noon, as a restaurant, the day's later stops moved on. Left out when it isn't a real
 * place within 3 km of that visit, the plan already holds it, it would start after half past two, the day eats at
 * midday by now, or the day has no room for it. Pure.
 */
export function withLunches<D extends Day>(days: D[], wanted: LunchWanted[], answer: LunchAnswer): { days: D[]; added: number } {
  let out = days;
  let added = 0;
  for (const entry of Array.isArray(answer.lunches) ? answer.lunches : []) {
    const n = entry?.n;
    const want = typeof n === "number" ? wanted[n - 1] : undefined;
    if (!want) continue;
    const at = out.findIndex((d) => (d.activities ?? []).some((s) => s.name === want.after));
    if (at < 0 || eatsAtMidday(out[at].activities ?? [])) continue;
    const visit = (out[at].activities ?? []).find((s) => s.name === want.after)!;
    const time = lunchAfter(visit);
    if (time === null || !isRealPoint(visit.coordinates)) continue;
    const cost = Number(entry.cost_per_person_usd);
    const activity = activityOf({
      ...entry,
      type: "restaurant",
      start_time: formatMinutesToTime(time),
      duration_minutes: LUNCH_MINUTES,
      ...(Number.isFinite(cost) && cost > 0 ? { estimated_cost: { amount: Math.round(cost), currency: "USD", tier: "moderate" } } : {}),
    });
    if (!activity?.coordinates || haversineKm(activity.coordinates, visit.coordinates) > NEAR_KM) continue;
    const names = out.flatMap((d) => d.activities ?? []).map((s) => nameTokens(s.name ?? ""));
    const words = nameTokens(activity.name);
    if (words.length === 0 || held(words, names)) continue;
    const day = withLunchAfter(out[at], visit, { ...activity, type: "restaurant" });
    if (!day) continue;
    out = out.map((d, i) => (i === at ? day : d));
    added++;
  }
  return { days: out, added };
}
