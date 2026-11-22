/**
 * The must-dos a traveller names are what they look for first in a plan, and a
 * plan sometimes holds one nowhere: Ichiran ramen and shopping in Harajuku on a
 * Tokyo trip, the pandas on a trip through Chengdu, Lake Como. Once a plan is
 * written, the must-dos it doesn't hold get one short question: on which day
 * each goes, as what, and in place of which activity when the day is full. An
 * answer goes in only when it fits its day; one the model leaves out (a place
 * hours away) stays out.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { isLockedActivity } from "@/lib/ai/anchors-core";
import { placesInOtherCities } from "@/lib/ai/multi-city-core";
import { nameTokens, sameWord } from "@/lib/ai/assistant/saved-activities";
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import type { Activity } from "@/types";

type Day = { day_number: number; date?: string; city?: string; activities: Activity[] };

// What kind of thing a must-do is, not which one: "Ichiran ramen" is Ichiran, "Lake Como" is Como.
const KINDS = new Set(
  (
    "temple palace park market museum tower bridge beach castle church cathedral garden village street square lake " +
    "mount mountain island waterfall falls glacier national cave river hill viewpoint observatory building site area " +
    "district center centre old town city quarter shopping shop store mall ramen sushi pizza restaurant cafe coffee bar " +
    "pub bakery hike hiking trek trekking ride boat cruise show concert mercado mercato marche museo museu musee playa " +
    "praia spiaggia plage iglesia chiesa igreja eglise catedral cattedrale parque parco jardin giardino castillo castello " +
    "castelo chateau plaza piazza praca calle rua puente ponte pont torre lago lac monte isla isola ilha"
  ).split(" ")
);
// Words of a wish rather than of a name: "eat good food", "take cute pics".
const NOT_A_NAME = new Set(
  (
    "eat eating good best great nice food foods take cute pics pictures photos photo learn local culture cultural group " +
    "activities activity nature relax relaxing fun nightlife night kids kid family romantic views view sunset sunrise " +
    "sightseeing history historic art arts see try things places place experience experiences authentic traditional " +
    "hidden gems drinks drink party adventure outdoor outdoors day days some lots more many from for into"
  ).split(" ")
);
const isKind = (word: string) =>
  KINDS.has(word) || (word.endsWith("es") && KINDS.has(word.slice(0, -2))) || (word.endsWith("s") && KINDS.has(word.slice(0, -1)));
const notAName = (word: string) => NOT_A_NAME.has(word) || (word.endsWith("s") && NOT_A_NAME.has(word.slice(0, -1)));

/** One must-do per thing: "Buda, temple, capybara cafe" is three. */
function items(mustDos: string[]): string[] {
  return [...new Set(mustDos.flatMap((m) => m.split(/[,;/]|\s[-–]\s/)).map((m) => m.trim()).filter(Boolean))];
}

/** The words that tell a must-do apart; none for a wish ("eat good food") or a kind alone ("museums"). */
function tellingWords(mustDo: string): string[] {
  return nameTokens(mustDo).filter((word) => !isKind(word) && !notAName(word));
}

/** Whether one of these names has every one of the words, a letter off allowed. */
export function held(words: string[], names: string[][]): boolean {
  return names.some((name) => words.every((word) => name.some((n) => sameWord(word, n))));
}

/**
 * Tells a stop the traveller asked for by name from the rest of the plan. The stop's name has to hold the must-do's
 * whole name, a letter off allowed, not only the words that tell it apart: on a London trip those are "London" for
 * the Tower of London, and every stop with London in its name would pass. A wish ("eat good food") or a kind alone
 * ("museums") names none.
 */
export function askedByName(mustDos: string[] | undefined): (stop: { name?: string }) => boolean {
  const asked = items(mustDos ?? [])
    .filter((mustDo) => tellingWords(mustDo).length > 0)
    .map((mustDo) => nameTokens(mustDo));
  return (stop) => asked.some((words) => held(words, [nameTokens(stop.name ?? "")]));
}

/**
 * The must-dos no activity of the plan holds. One is held when an activity's
 * name has every word that tells it apart, a letter off allowed: "gyeongbukgung
 * palace" is Gyeongbokgung Palace. A wish has no such word and is never
 * missing. Pure; unit-tested.
 */
export function missingMustDos(mustDos: string[], days: Array<{ activities?: Array<{ name?: string } | null> }>): string[] {
  const names = days.flatMap((d) => d.activities ?? []).map((a) => nameTokens(a?.name ?? ""));
  return items(mustDos).filter((mustDo) => {
    const words = tellingWords(mustDo);
    return words.length > 0 && !held(words, names);
  });
}

const minutesOf = (time: unknown): number | null => {
  const m = typeof time === "string" ? /^(\d{1,2}):(\d{2})$/.exec(time.trim()) : null;
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A day as the question shows it: each activity with its time and how long it takes. */
function dayLine(day: Day): string {
  const where = [day.date, day.city].filter(Boolean).join(", ");
  const stops = (day.activities ?? []).map((a) => {
    const start = minutesOf(a.start_time);
    const span = start === null ? "" : `${clock(start)}-${clock(start + (a.duration_minutes || 60))} `;
    return `${span}${a.name}${isLockedActivity(a) ? " (fixed)" : ""}`;
  });
  return `Day ${day.day_number}${where ? ` (${where})` : ""}: ${stops.join("; ")}`;
}

const TYPES = ["attraction", "landmark", "museum", "restaurant", "cafe", "bar", "food", "market", "shopping", "activity", "nature", "park", "entertainment", "nightlife", "spa", "cultural"];

const ACTIVITY: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    start_time: { type: SchemaType.STRING, description: "HH:MM" },
    duration_minutes: { type: SchemaType.INTEGER },
    name: { type: SchemaType.STRING },
    type: { type: SchemaType.STRING, enum: TYPES },
    description: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING, description: "The neighbourhood" },
    address: { type: SchemaType.STRING },
    coordinates: {
      type: SchemaType.OBJECT,
      properties: { lat: { type: SchemaType.NUMBER }, lng: { type: SchemaType.NUMBER } },
      required: ["lat", "lng"],
    },
    estimated_cost: {
      type: SchemaType.OBJECT,
      properties: {
        amount: { type: SchemaType.NUMBER },
        currency: { type: SchemaType.STRING },
        tier: { type: SchemaType.STRING, enum: ["free", "budget", "moderate", "expensive"] },
      },
      required: ["amount", "currency", "tier"],
    },
    tips: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    booking_required: { type: SchemaType.BOOLEAN },
  },
  required: ["start_time", "duration_minutes", "name", "type", "description", "location", "coordinates"],
};

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    added: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          must_do: { type: SchemaType.INTEGER, description: "Its number in the list" },
          day_number: { type: SchemaType.INTEGER },
          replaces: { type: SchemaType.STRING, description: "The exact name of the activity it takes the place of, or empty" },
          whole_day: { type: SchemaType.BOOLEAN, description: "True for a day trip that takes the day's other sights' place" },
          activity: ACTIVITY,
        },
        required: ["must_do", "day_number", "activity"],
      },
    },
    left_out: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: { must_do: { type: SchemaType.INTEGER }, why: { type: SchemaType.STRING } },
        required: ["must_do", "why"],
      },
    },
  },
  required: ["added", "left_out"],
};

/** What the model answers: each entry is checked before it goes in (withMustDos). */
export interface MustDoAnswer {
  added?: Array<{ must_do?: unknown; day_number?: unknown; replaces?: unknown; whole_day?: unknown; activity?: Record<string, unknown> }>;
}

const TIMEOUT_MS = 8000;

/**
 * Where the missing must-dos go, as the model sees it. No answer when there is
 * no key, or the question fails or takes too long: the plan then stays as it
 * was. The cost goes to the running request's meter, and is returned for a
 * route that sums its own.
 */
export async function askForMustDos(
  destination: string,
  days: Day[],
  missing: string[],
  language: SupportedLanguage
): Promise<{ answer: MustDoAnswer; costUsd: number }> {
  if (missing.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { answer: {}, costUsd: 0 };
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 4096,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  const cities = days.some((d) => d.city);
  const question = [
    `The traveller asked for these by name, and this ${days.length}-day plan for ${destination} doesn't have them:`,
    ...missing.map((m, i) => `${i + 1}. ${m}`),
    "",
    "The plan:",
    ...days.map(dayLine),
    "",
    `For each one, give one activity on the day where it fits best: near that day's other places${cities ? ", on a day in its city" : ""}, at the right time of day (a dish or a place to eat at lunch or dinner), at a start time when that day is free, or in place of one activity of that day that matters less ("replaces", its exact name; never a fixed one). Use the real place: a misspelled or partial name means the most likely real one, and a chain, a dish or a kind of activity means its best real place nearest that day's other places. These come first: the traveller asked for them by name, and the plan's own picks make way for them. A day trip that needs most of a day (a boat to an island, a ski day, a town further out) gets a whole day of its city even when that day is full: set whole_day true, run it from the morning to the late afternoon, on a day that is not the trip's first or last and has no ride, and that day's other sights make way. Never leave one out because a day is full or because it takes a whole day. Leave one out only when the plan already has it under another name, or when it can't be done on this trip at all (further than a day's return trip, closed on these dates).`,
    `Write each name as Google Maps shows it, and the description (about 25 words) and tips in ${LANGUAGE_NAMES[language]}.`,
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Must-dos");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as MustDoAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[must-dos] not asked:", err instanceof Error ? err.message : String(err));
    return { answer: {}, costUsd: 0 };
  }
}

/** The activity of an answer, with only what a plan's activity holds, or null when it isn't one. */
export function activityOf(raw: Record<string, unknown> | undefined): Activity | null {
  if (!raw || typeof raw.name !== "string" || !raw.name.trim()) return null;
  const start = minutesOf(raw.start_time);
  const length = Number(raw.duration_minutes);
  const point = raw.coordinates as { lat?: number; lng?: number } | undefined;
  if (start === null || !(length >= 15 && length <= 600) || !isRealPoint(point)) return null;
  const cost = raw.estimated_cost as Activity["estimated_cost"] | undefined;
  return {
    start_time: clock(start),
    time_slot: determineTimeSlot(clock(start)),
    duration_minutes: Math.round(length),
    name: raw.name.trim(),
    type: typeof raw.type === "string" && TYPES.includes(raw.type) ? raw.type : "attraction",
    description: typeof raw.description === "string" ? raw.description : "",
    location: typeof raw.location === "string" ? raw.location : "",
    ...(typeof raw.address === "string" && raw.address ? { address: raw.address } : {}),
    coordinates: { lat: point.lat, lng: point.lng },
    ...(cost && Number.isFinite(cost.amount) && typeof cost.currency === "string" ? { estimated_cost: cost } : {}),
    tips: Array.isArray(raw.tips) ? raw.tips.filter((t): t is string => typeof t === "string") : [],
    booking_required: raw.booking_required === true,
  };
}

/** How many minutes two activities share. */
function overlap(a: Activity, b: Activity): number {
  const s = minutesOf(a.start_time);
  const t = minutesOf(b.start_time);
  if (s === null || t === null) return 0;
  return Math.min(s + (a.duration_minutes || 60), t + (b.duration_minutes || 60)) - Math.max(s, t);
}

/** An answer this long, marked whole_day, is a day trip that takes its day. */
const WHOLE_DAY_MINUTES = 240;

/**
 * Whether a day trip may take day `at`: not the trip's first or last day, no ride that day, and its city keeps
 * another day of its own (on a trip through several cities; any other day on a trip to one place).
 */
function mayTakeWholeDay(days: Day[], at: number): boolean {
  if (at <= 0 || at >= days.length - 1) return false;
  const day = days[at];
  if (day.activities.some((a) => a.type === "transport" || Boolean((a as { transport_mode?: string }).transport_mode))) return false;
  return days.some((d, i) => i !== at && d.city === day.city);
}

/**
 * The plan's days with the answer's activities in. Each is checked first: on
 * a day of the plan, a real place with a time, not one the plan already has,
 * in its day's city on a trip through several, and clear of that day's other
 * activities, give or take half an hour, but the one it replaces (never a
 * fixed one or a transfer). Pure; unit-tested.
 */
export function withMustDos<D extends Day>(days: D[], missing: string[], answer: MustDoAnswer): { days: D[]; added: string[] } {
  let out = days;
  const added: string[] = [];
  for (const entry of answer.added ?? []) {
    const mustDo = typeof entry.must_do === "number" ? missing[entry.must_do - 1] : undefined;
    const at = out.findIndex((d) => d.day_number === entry.day_number);
    const activity = activityOf(entry.activity);
    if (!mustDo || added.includes(mustDo) || at < 0 || !activity) continue;
    const words = nameTokens(activity.name);
    if (words.length === 0 || held(words, out.flatMap((d) => d.activities ?? []).map((a) => nameTokens(a?.name ?? "")))) continue;
    const day = out[at];
    const gone = typeof entry.replaces === "string" ? entry.replaces.trim().toLowerCase() : "";
    const replaced = gone
      ? day.activities.find((a) => a.name?.trim().toLowerCase() === gone && !isLockedActivity(a) && a.type !== "transport")
      : undefined;
    // A day trip (marked, or long) takes its day where it may; one marked for a day it may not take stays out.
    const wholeDay = (activity.duration_minutes || 0) >= WHOLE_DAY_MINUTES && mayTakeWholeDay(out, at);
    if (entry.whole_day === true && !wholeDay) continue;
    // A whole day: the day's other stops in the trip's hours make way, but a fixed one (which then keeps it out).
    const rest = wholeDay
      ? day.activities.filter((a) => isLockedActivity(a) || overlap(a, activity) <= 0)
      : day.activities.filter((a) => a !== replaced);
    if (rest.some((a) => overlap(a, activity) > 30)) continue;
    const activities = [...rest, activity].sort((a, b) => (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0));
    if (day.city) {
      // On a trip through several cities, in its day's city (lib/ai/multi-city-core).
      const places = out.flatMap((d, i) =>
        d.city
          ? (i === at ? activities : d.activities)
              .filter((a) => a.type !== "transport" && isRealPoint(a.coordinates))
              .map((a) => ({ city: d.city as string, point: a.coordinates as { lat: number; lng: number }, mine: a === activity }))
          : []
      );
      if (placesInOtherCities(places).has(places.findIndex((p) => p.mine))) continue;
    }
    out = out.map((d, i) => (i === at ? { ...d, activities } : d));
    added.push(mustDo);
  }
  return { days: out, added };
}

/** A plan with the must-dos it held nowhere put in where they fit, and how many were missing and put in. */
export async function keepMustDos<T extends { days: D[] }, D extends Day>(
  itinerary: T,
  destination: string,
  mustDos: string[] | undefined,
  language: SupportedLanguage,
  ask: typeof askForMustDos = askForMustDos
): Promise<{ itinerary: T; costUsd: number; missing: number; added: number }> {
  const missing = missingMustDos(mustDos ?? [], itinerary.days);
  if (missing.length === 0) return { itinerary, costUsd: 0, missing: 0, added: 0 };
  const { answer, costUsd } = await ask(destination, itinerary.days, missing, language);
  const { days, added } = withMustDos(itinerary.days, missing, answer);
  return { itinerary: added.length > 0 ? { ...itinerary, days } : itinerary, costUsd, missing: missing.length, added: added.length };
}
