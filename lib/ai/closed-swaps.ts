/**
 * Some sights are shut on every date a plan could move them to: over New Year
 * in Tokyo the national museums and gardens close for days on end. Once the
 * closing-day check has ordered the days and moved what it could
 * (lib/ai/closing-days.ts), a sight still shut on its day gets one short
 * question: up to three places to go instead, best first, open that date, near
 * that day's other places. Each is put to the closing-day question on its date,
 * and the first open one goes in, in the closed place's time and length, when
 * it is a real place the plan doesn't already hold; otherwise the closed place
 * stays. One offer often isn't enough: on a Monday in Rome the museums a model
 * thinks of first are shut too.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { activityOf, held } from "@/lib/ai/must-dos";
import { nameTokens } from "@/lib/ai/assistant/saved-activities";
import { WEEKDAYS, askClosingDays, stopShutOn, type StuckStop } from "@/lib/ai/closing-days";
import { formatMinutesToTime } from "@/lib/datetime/format";
import type { Activity } from "@/types";

type Stop = { name?: string; start_time?: string; duration_minutes?: number; time_slot?: string };
type Day = { day_number?: number; date?: string; title?: string; theme?: string; activities?: Stop[] };

/** A day's title or theme that named the closed place, naming the one in its place. */
const renamed = (words: string | undefined, closed: string, open: string) =>
  typeof words === "string" && words.includes(closed) ? { value: words.split(closed).join(open) } : null;

/** The offers read for each closed place, best first. */
const MAX_OFFERS = 3;

/** A place offered: what a stop needs besides its time, which stays the closed place's. */
const PLACE: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    type: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING, description: "The neighbourhood" },
    coordinates: {
      type: SchemaType.OBJECT,
      properties: { lat: { type: SchemaType.NUMBER }, lng: { type: SchemaType.NUMBER } },
      required: ["lat", "lng"],
    },
  },
  required: ["name", "type", "description", "location", "coordinates"],
};

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    swaps: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          n: { type: SchemaType.INTEGER, description: "The closed place's number in the list" },
          places: { type: SchemaType.ARRAY, items: PLACE, description: "Up to three, best first" },
        },
        required: ["n", "places"],
      },
    },
  },
  required: ["swaps"],
};

/** What the model answers: each offer is checked before it goes in (offersOf, withSwaps). */
export interface SwapAnswer {
  swaps?: Array<{ n?: unknown; places?: unknown }>;
}

/** A real place offered for a closed one, as a plan's activity in the closed place's time. */
export interface Offer {
  closed: StuckStop;
  activity: Activity;
}

const TIMEOUT_MS = 10_000;

const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** "09:30-12:00" when the stop has a time and a length, "09:30" with a time only. */
function span(stop: StuckStop): string {
  const start = minutesOf(stop.start_time);
  if (start === null) return "";
  return stop.duration_minutes
    ? `${formatMinutesToTime(start)}-${formatMinutesToTime(start + stop.duration_minutes)}`
    : formatMinutesToTime(start);
}

function stuckLine(stop: StuckStop, n: number): string {
  const when = span(stop);
  return `${n}. Day ${stop.day} (${weekdayOf(stop.date)} ${stop.date})${when ? `, ${when}` : ""}: ${stop.name}`;
}

function dayLine(day: Day): string {
  const stops = (day.activities ?? []).map((a) => [a.start_time, a.name].filter(Boolean).join(" "));
  return `Day ${day.day_number}${day.date ? ` (${day.date})` : ""}: ${stops.join("; ")}`;
}

/**
 * Places to go instead of each closed one, as the model sees them. No answer
 * when there is no key, or the question fails or takes too long: the plan then
 * stays as it was. The cost goes to the running request's meter, and is
 * returned for a route that sums its own.
 */
export async function askForSwaps(
  destination: string,
  days: Day[],
  stuck: StuckStop[],
  language: SupportedLanguage
): Promise<{ answer: SwapAnswer; costUsd: number }> {
  if (stuck.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { answer: {}, costUsd: 0 };
  const modelName = getModelForPurpose("closed-swaps");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 4096,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  const question = [
    `In this ${days.length}-day plan for ${destination}, these places are closed to visitors on the date they are planned, and no other day of the trip can take them:`,
    ...stuck.map((stop, i) => stuckLine(stop, i + 1)),
    "",
    "The plan:",
    ...days.map(dayLine),
    "",
    "For each, give up to three places to go instead, best first, each at that time on that day and open to visitors on that date: of the same kind when one is open then (a museum for a museum, a garden or park for a garden), otherwise anything worth that time nearby (a church, a park, a market, a viewpoint); near that day's other places, and not one the plan already has. Give none when there is no such place.",
    `Write each name as Google Maps shows it, and the description (about 20 words) in ${LANGUAGE_NAMES[language]}.`,
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Closed swaps");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as SwapAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[closed-swaps] not asked:", err instanceof Error ? err.message : String(err));
    return { answer: {}, costUsd: 0 };
  }
}

/** The real places an answer offers, best first for each closed place, at most three each. Pure; unit-tested. */
export function offersOf(answer: SwapAnswer, stuck: StuckStop[]): Offer[] {
  return (answer.swaps ?? []).flatMap((entry) => {
    const closed = typeof entry.n === "number" ? stuck[entry.n - 1] : undefined;
    const places = Array.isArray(entry.places) ? (entry.places as unknown[]).slice(0, MAX_OFFERS) : [];
    if (!closed) return [];
    return places.flatMap((place) => {
      const activity =
        place && typeof place === "object"
          ? activityOf({ ...(place as Record<string, unknown>), start_time: closed.start_time ?? "12:00", duration_minutes: closed.duration_minutes ?? 90 })
          : null;
      return activity ? [{ closed, activity }] : [];
    });
  });
}

/**
 * The days with each closed place replaced by the first of its offers that can
 * go in: in the closed place's time and length so the rest of its day stays as
 * it was, and named in its place in the day's title or theme where they named
 * it. An offer goes in only when the plan doesn't already hold it and it isn't
 * the closed place under another name. Pure; unit-tested.
 */
export function withSwaps<D extends Day>(days: D[], offers: Offer[]): { days: D[]; swapped: number } {
  let out = days;
  let swapped = 0;
  for (const { closed, activity } of offers) {
    const words = nameTokens(activity.name);
    const names = out.flatMap((d) => d.activities ?? []).map((a) => nameTokens(a?.name ?? ""));
    if (words.length === 0 || held(words, names) || held(nameTokens(closed.name), [words])) continue;
    const at = out.findIndex((d) => d.day_number === closed.day);
    // Once swapped, a closed place is no longer on its day: its later offers find nothing to replace.
    const old = at < 0 ? undefined : (out[at].activities ?? []).find((a) => a?.name === closed.name);
    if (!old) continue;
    const swap = {
      ...activity,
      start_time: old.start_time ?? activity.start_time,
      time_slot: old.time_slot ?? activity.time_slot,
      duration_minutes: old.duration_minutes ?? activity.duration_minutes,
    };
    const title = renamed(out[at].title, closed.name, swap.name);
    const theme = renamed(out[at].theme, closed.name, swap.name);
    out = out.map((d, i) =>
      i === at
        ? {
            ...d,
            ...(title ? { title: title.value } : {}),
            ...(theme ? { theme: theme.value } : {}),
            activities: (d.activities ?? []).map((a) => (a === old ? swap : a)),
          }
        : d
    );
    swapped++;
  }
  return { days: out, swapped };
}

/**
 * The days with the closed places swapped where the model offers an open one,
 * how many, and what the questions cost. Every offer is asked about as the
 * plan's places were (askClosingDays), on its closed place's date, and one shut
 * that day too is passed over for the next. When that check can't be asked, the
 * offers go in as answered.
 */
export async function swapClosedStops<D extends Day>(
  destination: string,
  days: D[],
  stuck: StuckStop[],
  language: SupportedLanguage,
  ask: typeof askForSwaps = askForSwaps,
  check: typeof askClosingDays = askClosingDays
): Promise<{ days: D[]; swapped: number; costUsd: number }> {
  if (stuck.length === 0) return { days, swapped: 0, costUsd: 0 };
  const { answer, costUsd } = await ask(destination, days, stuck, language);
  const offers = offersOf(answer, stuck);
  if (offers.length === 0) return { days, swapped: 0, costUsd };
  const names = [...new Set(offers.map((o) => o.activity.name))];
  const shut = await check(destination, names, [...new Set(offers.map((o) => o.closed.date))]);
  const open = offers.filter((o) => !stopShutOn({ name: o.activity.name }, o.closed.date, shut.closings, shut.shutDates));
  return { ...withSwaps(days, open), costUsd: costUsd + shut.costUsd };
}
