/**
 * A plan is asked for lunch and dinner on every full day (lib/ai/trip-prompt.ts) and still leaves dinner out of
 * some: a family trip to Kyoto in the benchmark had none on any of its three full days. So each full day without an
 * evening meal gets one: a real restaurant near the day's last place, or back in town after a day out of town, from
 * one short question for all such days, asked beside the closing-day question so the plan isn't slower. The answer
 * goes in once the days are final, after the day's last place: half an hour after its visit ends (and the ride back,
 * for a dinner in town after a day out), not before dinner starts there (from 18:30, later in Spain and southern
 * Europe: lib/ai/meal-hours.ts). A restaurant that isn't a real place near where it was looked for, one the plan
 * already holds, or one that would start after the latest dinner hour there is left out, and the day stays as it was.
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
import { dinnerHours, type DinnerHours } from "./meal-hours";

type Stop = Partial<Activity> & { name?: string; type?: string; start_time?: string; duration_minutes?: number };
type Day = { day_number?: number; date?: string; city?: string; activities?: Stop[] };

/** From the end of the day's last visit to dinner. */
const AFTER_MINUTES = 30;
const DINNER_MINUTES = 90;
/** How far from the place it was chosen near a dinner may be. */
const NEAR_KM = 5;
/** A day whose last place is farther than this from where its city's days come back to ends out of town. */
const OUT_OF_TOWN_KM = 15;
/** The ride back to town, in minutes for each kilometre in a straight line: the roads' turns, at a country pace. */
const BACK_MINUTES_PER_KM = 1.5;
/** The fewest pins a city's days need to tell where they gather. */
const TOWN_PINS = 4;
/** At most this many days in one question. */
const MAX_DAYS = 10;
/** At most this many of the plan's own places to eat named in the question. */
const MAX_TAKEN = 40;
const TIMEOUT_MS = 8000;

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

type Point = { lat: number; lng: number };

/** A day without dinner: the place the dinner is chosen near, where it is, and when the day's visits end. */
export interface DinnerWanted {
  /** The day's last place with a time and a pin: dinner is looked for near it, and follows it. */
  after: string;
  at: Point;
  date: string;
  city: string;
  /** When dinner can start there (lib/ai/meal-hours.ts). */
  hours: DinnerHours;
  /** A day that ends out of town: where in town dinner can be instead, after the ride back. */
  town?: Point;
}

const isEveningMeal = (stop: Stop) => isMealStop(stop) && (minutesOf(stop.start_time) ?? 0) >= 17 * 60;
const STAY = /^(accommodation|hotel|lodging)$/;

/**
 * Where a city's days come back to: the plan's stay there, or else the middle of the days' pins, as many north of it
 * as south and east as west. None with too few pins to tell.
 */
function townOf(days: Day[], city: string | undefined): Point | null {
  const stops = days.filter((d) => (d.city ?? "") === (city ?? "")).flatMap((d) => d.activities ?? []);
  const stay = stops.find((s) => STAY.test(s.type ?? "") && isRealPoint(s.coordinates));
  if (stay?.coordinates) return { lat: stay.coordinates.lat, lng: stay.coordinates.lng };
  const pins = stops.filter((s) => s.type !== "transport" && isRealPoint(s.coordinates)).map((s) => s.coordinates as Point);
  if (pins.length < TOWN_PINS) return null;
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { lat: mid(pins.map((p) => p.lat)), lng: mid(pins.map((p) => p.lng)) };
}

/**
 * The full days (not the plan's first or last) with no meal from 17:00, each with the place dinner goes after and the
 * dinner hours there; a family that eats early (eatsEarly) has the usual ones. A day that ends out of town can have
 * dinner back in town too: after a day up the coast the model names one in town, and it was turned away as far.
 */
export function daysWithoutDinner(days: Day[], destination: string, early = false): DinnerWanted[] {
  return days.flatMap((day, i) => {
    const stops = day.activities ?? [];
    if (i === 0 || i === days.length - 1 || !day.date || stops.length === 0 || stops.some(isEveningMeal)) return [];
    const last = [...stops]
      // Dinner goes near a place that is where its pin says: not the placeholder of a stop with no location.
      .filter((s) => s.name && minutesOf(s.start_time) !== null && s.type !== "transport" && isRealPoint(s.coordinates))
      .sort((a, b) => (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0))
      .at(-1);
    if (!last?.name || !last.coordinates) return [];
    const at = { lat: last.coordinates.lat, lng: last.coordinates.lng };
    const town = townOf(days, day.city);
    const outOfTown = !!town && haversineKm(at, town) > OUT_OF_TOWN_KM;
    return [{ after: last.name, at, date: day.date, city: day.city || destination, hours: dinnerHours(at, early), ...(outOfTown ? { town } : {}) }];
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

const pointText = (p: Point) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

/**
 * The question: the evenings, from when dinner can start, where each day ends, the budget and diets, and the places
 * the plan already eats at.
 */
export function dinnerQuestion(wanted: DinnerWanted[], opts: DinnerOptions): string {
  return [
    "Name one real restaurant for dinner on each of these evenings, within a short walk or ride of the place the day ends at (after a day out of town, of the place in town given), serving dinner on that date from the hour given:",
    ...wanted.map((w, i) => {
      const day = `${i + 1}. ${w.city}, ${w.date}, dinner from ${formatMinutesToTime(w.hours.from)}`;
      return w.town
        ? `${day}: the day ends out of town at ${w.after} (${pointText(w.at)}), and dinner is back in town: near (${pointText(w.town)})`
        : `${day}: the day ends at ${w.after} (${pointText(w.at)})`;
    }),
    "",
    `Each one ${BUDGET_WORDS[opts.budgetTier ?? "balanced"]}${opts.diets?.length ? `, with good choices for a ${opts.diets.join(" and ")} diet` : ""}, and a different restaurant each evening.`,
    ...(opts.taken?.length ? [`None the plan already has: ${opts.taken.join("; ")}.`] : []),
    `Write each name as Google Maps shows it, its exact coordinates, and the description (about 20 words: what to eat there and why) in ${LANGUAGE_NAMES[opts.language]}.`,
  ].join("\n");
}

/**
 * How many times the question is asked, all at once. Its answers vary, and the model often names a restaurant the
 * plan has or one too far away: a second answer fills evenings the first couldn't, with no wait added.
 */
const ASKS = 2;

/**
 * Dinners for the days without one, as the model sees them: every answer's, the first answer's first, so a later
 * answer's dinner goes in only on an evening the earlier ones couldn't fill (withDinners). No answer when there is
 * nothing to ask, no key, or every question fails or takes too long: the days then stay as they were.
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
  const question = dinnerQuestion(wanted, opts);
  const askOnce = async (): Promise<{ answer: DinnerAnswer; costUsd: number }> => {
    try {
      const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Dinners");
      const usage = result.response.usageMetadata;
      recordGeminiUsage(modelName, usage);
      return { answer: JSON.parse(result.response.text()) as DinnerAnswer, costUsd: geminiCostUsd(modelName, usage) };
    } catch (err) {
      console.warn("[dinners] not asked:", err instanceof Error ? err.message : String(err));
      return { answer: {}, costUsd: 0 };
    }
  };
  const answers = await Promise.all(Array.from({ length: ASKS }, askOnce));
  return {
    answer: { dinners: answers.flatMap((a) => a.answer.dinners ?? []) },
    costUsd: answers.reduce((sum, a) => sum + a.costUsd, 0),
  };
}

/**
 * Why a day asked about still has no dinner: no answer named it, the place it follows is gone from the plan, the
 * dinner would start after the latest dinner hour there, the answer is no real place (no name, no pin), is farther
 * than 5 km from that place (and, after a day out of town, not back in town either), or is a place the plan already
 * holds.
 */
export type DinnerLeftOut = "unanswered" | "gone" | "late" | "unreal" | "far" | "taken";

/** How many days asked about still have no dinner, by why: the first answer turned away for each, or no answer. */
export type DinnersLeft = Partial<Record<DinnerLeftOut, number>>;

/** Two or more counts of days left without dinner, as one. */
export function dinnersLeftTogether(...lefts: DinnersLeft[]): DinnersLeft {
  const out: DinnersLeft = {};
  for (const left of lefts) {
    for (const [why, n] of Object.entries(left) as Array<[DinnerLeftOut, number]>) out[why] = (out[why] ?? 0) + n;
  }
  return out;
}

/**
 * The days with each answered dinner after the place it follows, wherever that place now is: half an hour after its
 * visit ends, and after the ride back for a dinner back in town after a day out, not before dinner starts there, as a
 * restaurant. Left out when it isn't a real place within 5 km of that place (or, after a day out of town, back in
 * town), the plan already holds it, it would start after the latest dinner hour there, or the day has an evening meal
 * by now. `left` says, for the days asked about that still have none, why. Pure.
 */
export function withDinners<D extends Day>(
  days: D[],
  wanted: DinnerWanted[],
  answer: DinnerAnswer
): { days: D[]; added: number; left: DinnersLeft } {
  let out = days;
  let added = 0;
  // For each day asked about, the first reason an answer for it was turned away; and the days that have dinner now.
  const why = new Map<number, DinnerLeftOut>();
  const fed = new Set<number>();
  for (const entry of answer.dinners ?? []) {
    const n = typeof entry.n === "number" ? entry.n - 1 : -1;
    const want = wanted[n];
    if (!want) continue;
    const turnedAway = (reason: DinnerLeftOut) => void (why.has(n) || why.set(n, reason));
    const at = out.findIndex((d) => (d.activities ?? []).some((s) => s.name === want.after));
    if (at < 0) {
      turnedAway("gone");
      continue;
    }
    if ((out[at].activities ?? []).some(isEveningMeal)) {
      fed.add(n);
      continue;
    }
    const anchor = (out[at].activities ?? []).find((s) => s.name === want.after)!;
    const ends = (minutesOf(anchor.start_time) ?? 0) + (anchor.duration_minutes || 60);
    const startAfter = (ride: number) => Math.ceil(Math.max(want.hours.from, ends + AFTER_MINUTES + ride) / 15) * 15;
    if (startAfter(0) > want.hours.by) {
      turnedAway("late");
      continue;
    }
    const cost = Number(entry.cost_per_person_usd);
    const activity = activityOf({
      ...entry,
      type: "restaurant",
      start_time: formatMinutesToTime(startAfter(0)),
      duration_minutes: DINNER_MINUTES,
      ...(Number.isFinite(cost) && cost > 0 ? { estimated_cost: { amount: Math.round(cost), currency: "USD", tier: "moderate" } } : {}),
    });
    const words = activity ? nameTokens(activity.name) : [];
    if (!activity || !activity.coordinates || words.length === 0) {
      turnedAway("unreal");
      continue;
    }
    // After a day out of town, back in town once the ride back from where the day ends is done; or on the way, as the
    // middle of the days' pins is only near where they stay.
    const nearEnd = haversineKm(activity.coordinates, want.at) <= NEAR_KM;
    const inTown = !nearEnd && !!want.town && haversineKm(activity.coordinates, want.town) <= Math.max(NEAR_KM, haversineKm(want.at, want.town) / 2);
    if (!nearEnd && !inTown) {
      turnedAway("far");
      continue;
    }
    const start = startAfter(inTown ? Math.round(haversineKm(want.at, activity.coordinates) * BACK_MINUTES_PER_KM) : 0);
    if (start > want.hours.by) {
      turnedAway("late");
      continue;
    }
    const names = out.flatMap((d) => d.activities ?? []).map((s) => nameTokens(s.name ?? ""));
    if (held(words, names)) {
      turnedAway("taken");
      continue;
    }
    const dinner = { ...activity, type: "restaurant", start_time: formatMinutesToTime(start) } as Activity;
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
    fed.add(n);
  }
  const left: DinnersLeft = {};
  wanted.forEach((_, n) => {
    if (fed.has(n)) return;
    const reason = why.get(n) ?? "unanswered";
    left[reason] = (left[reason] ?? 0) + 1;
  });
  return { days: out, added, left };
}
