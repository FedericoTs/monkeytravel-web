/**
 * Some sights are shut on every date a plan could move them to: over New Year
 * in Tokyo the national museums and gardens close for days on end. Once the
 * closing-day check has ordered the days and moved what it could
 * (lib/ai/closing-days.ts), a sight still shut on its day gets one short
 * question: a place to go instead, at that time on that day, open that date,
 * of the same kind and near that day's other places. An answer goes in, in the
 * closed place's time and length, only when it is a real place the plan
 * doesn't already hold and the closing-day question finds it open that date;
 * otherwise the closed place stays.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { ACTIVITY, activityOf, held } from "@/lib/ai/must-dos";
import { nameTokens } from "@/lib/ai/assistant/saved-activities";
import { WEEKDAYS, askClosingDays, stopShutOn, type StuckStop } from "@/lib/ai/closing-days";
import { formatMinutesToTime } from "@/lib/datetime/format";

type Stop = { name?: string; start_time?: string; duration_minutes?: number; time_slot?: string };
type Day = { day_number?: number; date?: string; title?: string; theme?: string; activities?: Stop[] };

/** A day's title or theme that named the closed place, naming the one in its place. */
const renamed = (words: string | undefined, closed: string, open: string) =>
  typeof words === "string" && words.includes(closed) ? { value: words.split(closed).join(open) } : null;

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    swaps: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          n: { type: SchemaType.INTEGER, description: "The closed place's number in the list" },
          activity: ACTIVITY,
        },
        required: ["n", "activity"],
      },
    },
  },
  required: ["swaps"],
};

/** What the model answers: each entry is checked before it goes in (withSwaps). */
export interface SwapAnswer {
  swaps?: Array<{ n?: unknown; activity?: Record<string, unknown> }>;
}

const TIMEOUT_MS = 6000;

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
 * A place to go instead of each closed one, as the model sees it. No answer
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
    "For each, give one place to go instead, at that time on that day: open to visitors on that date, of the same kind (a museum for a museum, a garden or park for a garden), near that day's other places, and not one the plan already has. Leave one out when there is no such place.",
    `Write each name as Google Maps shows it, and the description (about 25 words) and tips in ${LANGUAGE_NAMES[language]}.`,
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

/**
 * The days with each closed place the answer has a swap for replaced, in the
 * closed place's time and length so the rest of its day stays as it was, and
 * named in its place in the day's title or theme where they named it. A swap
 * goes in only when it is a real place (activityOf) that the plan doesn't
 * already hold and that isn't the closed place under another name. Pure;
 * unit-tested.
 */
export function withSwaps<D extends Day>(days: D[], stuck: StuckStop[], answer: SwapAnswer): { days: D[]; swapped: number } {
  let out = days;
  let swapped = 0;
  for (const entry of answer.swaps ?? []) {
    const n = typeof entry.n === "number" ? entry.n : 0;
    const closed = stuck[n - 1];
    const activity = activityOf(entry.activity);
    // Once swapped, a closed place is no longer on its day: a second answer for it finds nothing to replace.
    if (!closed || !activity) continue;
    const words = nameTokens(activity.name);
    const names = out.flatMap((d) => d.activities ?? []).map((a) => nameTokens(a?.name ?? ""));
    if (words.length === 0 || held(words, names) || held(nameTokens(closed.name), [words])) continue;
    const at = out.findIndex((d) => d.day_number === closed.day);
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
 * The days with the closed places swapped where the model has an open one, how
 * many, and what the questions cost. Each swap is then asked about as the
 * plan's places were (askClosingDays), on its own date, and one shut that day
 * too stays out. When that check can't be asked, the swaps go in as answered.
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
  const offered = (answer.swaps ?? []).flatMap((entry) => {
    const closed = typeof entry.n === "number" ? stuck[entry.n - 1] : undefined;
    const activity = activityOf(entry.activity);
    return closed && activity ? [{ entry, name: activity.name, date: closed.date }] : [];
  });
  if (offered.length === 0) return { days, swapped: 0, costUsd };
  const shut = await check(destination, offered.map((o) => o.name), [...new Set(offered.map((o) => o.date))]);
  const open = offered.filter((o) => !stopShutOn({ name: o.name }, o.date, shut.closings, shut.shutDates)).map((o) => o.entry);
  return { ...withSwaps(days, stuck, { swaps: open }), costUsd: costUsd + shut.costUsd };
}
