/**
 * Plans put sights on days they're shut. Writing a whole plan, the model gets
 * weekly closing days wrong that it gets right when asked about one place at a
 * time. So once a plan is written, one short question asks on which weekdays
 * each of its sights and markets is shut, and the days are put in the order
 * that leaves the fewest of them on such a day. Each date keeps its place and
 * number; the days' contents move. Meals are not asked about: the model's word
 * on a restaurant's closing day is unreliable.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** A place's name, lower-cased, to the weekdays it is shut. */
export type Closings = Map<string, Weekday[]>;

type Stop = { name?: string; type?: string };
type Day = { day_number?: number; date?: string; activities?: Stop[] };

/** The kinds of stop asked about. */
const ASKED = new Set(["museum", "landmark", "attraction", "market", "entertainment", "tour", "spa", "activity"]);
/** At most this many places in one question. */
const MAX_PLACES = 40;
const TIMEOUT_MS = 5000;

const placeKey = (name: string) => name.trim().toLowerCase();

/** The plan's sights and markets, each once, in plan order. */
export function placesToAsk(days: Day[]): string[] {
  const places = new Map<string, string>();
  for (const day of days) {
    for (const stop of day.activities ?? []) {
      const name = stop.name?.trim();
      if (name && ASKED.has(String(stop.type)) && !places.has(placeKey(name))) places.set(placeKey(name), name);
    }
  }
  return [...places.values()].slice(0, MAX_PLACES);
}

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    places: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          n: { type: SchemaType.INTEGER },
          closed: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING, enum: [...WEEKDAYS] } },
        },
        required: ["n", "closed"],
      },
    },
  },
  required: ["places"],
};

/**
 * Each place's weekly closing days. None when there is no key, or the
 * question fails or takes too long: the plan then keeps its order. The cost
 * goes to the running request's meter, and is returned for a route that sums
 * its own.
 */
export async function askClosingDays(
  destination: string,
  places: string[]
): Promise<{ closings: Closings; costUsd: number }> {
  const closings: Closings = new Map();
  if (places.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { closings, costUsd: 0 };
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 2048,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  const question = [
    `On which days of the week is each of these places in ${destination} closed to visitors, every week? Leave out public holidays and seasonal closures. A place open every day has an empty list.`,
    ...places.map((place, i) => `${i + 1}. ${place}`),
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Closing days");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    const answer = JSON.parse(result.response.text()) as { places?: Array<{ n?: unknown; closed?: unknown }> };
    for (const entry of answer.places ?? []) {
      const place = typeof entry.n === "number" ? places[entry.n - 1] : undefined;
      const days = Array.isArray(entry.closed)
        ? WEEKDAYS.filter((weekday) => (entry.closed as unknown[]).includes(weekday))
        : [];
      if (place && days.length > 0) closings.set(placeKey(place), days);
    }
    return { closings, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[closing-days] not checked:", err instanceof Error ? err.message : String(err));
    return { closings, costUsd: 0 };
  }
}

const weekdayOf = (date?: string): Weekday | null =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] : null;

/** How many of a day's stops are shut on a weekday. */
function shutOn(day: Day, weekday: Weekday | null, closings: Closings): number {
  if (!weekday) return 0;
  return (day.activities ?? []).filter((stop) => stop.name && closings.get(placeKey(stop.name))?.includes(weekday)).length;
}

/** How many of the days' stops fall on a day they're shut. */
export function shutStops(days: Day[], closings: Closings): number {
  return days.reduce((sum, day) => sum + shutOn(day, weekdayOf(day.date), closings), 0);
}

/** order[slot] is the index of the day whose contents go to that slot. Lower is better: stops shut, ends moved, days moved. */
function score(order: number[], shut: number[][]): [number, number, number] {
  const last = order.length - 1;
  return [
    order.reduce((sum, from, slot) => sum + shut[from][slot], 0),
    (order[0] !== 0 ? 1 : 0) + (order[last] !== last ? 1 : 0),
    order.filter((from, slot) => from !== slot).length,
  ];
}

const better = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/** The best order of all, for a trip short enough to try them all. */
function bestOrder(shut: number[][], movable: boolean[]): number[] {
  const free = movable.flatMap((can, i) => (can ? [i] : []));
  let best = shut.map((_, i) => i);
  let bestScore = score(best, shut);
  const place = (rest: number[], picked: number[]) => {
    if (rest.length === 0) {
      const order = shut.map((_, i) => i);
      free.forEach((slot, k) => (order[slot] = picked[k]));
      const s = score(order, shut);
      if (better(s, bestScore)) [best, bestScore] = [order, s];
      return;
    }
    rest.forEach((day, k) => place([...rest.slice(0, k), ...rest.slice(k + 1)], [...picked, day]));
  };
  place(free, []);
  return best;
}

/** For a longer trip: the swap of two days that does most good, again and again, while one leaves fewer stops shut. */
function swappedOrder(shut: number[][], movable: boolean[]): number[] {
  const order = shut.map((_, i) => i);
  for (;;) {
    let bestSwap: [number, number] | null = null;
    let bestScore = score(order, shut);
    const shutNow = bestScore[0];
    for (let a = 0; a < order.length; a++) {
      for (let b = a + 1; b < order.length; b++) {
        if (!movable[a] || !movable[b]) continue;
        [order[a], order[b]] = [order[b], order[a]];
        const s = score(order, shut);
        if (s[0] < shutNow && better(s, bestScore)) [bestSwap, bestScore] = [[a, b], s];
        [order[a], order[b]] = [order[b], order[a]];
      }
    }
    if (!bestSwap) return order;
    const [a, b] = bestSwap;
    [order[a], order[b]] = [order[b], order[a]];
  }
}

/**
 * The days in the order that leaves the fewest stops on a day they're shut;
 * among orders as good, the one that keeps the first and last days in place,
 * then the one that moves fewest days. A day with a dated event keeps its
 * date. Each date keeps its place and number. The same array when nothing
 * moves.
 */
export function orderAroundClosings<T extends Day>(days: T[], closings: Closings): T[] {
  if (closings.size === 0 || days.length < 2) return days;
  const weekdays = days.map((day) => weekdayOf(day.date));
  const shut = days.map((day) => weekdays.map((weekday) => shutOn(day, weekday, closings)));
  const movable = days.map((day) => !(day.activities ?? []).some((stop) => stop.type === "event"));
  const order = days.length <= 7 ? bestOrder(shut, movable) : swappedOrder(shut, movable);
  if (order.every((from, slot) => from === slot)) return days;
  return order.map((from, slot) => ({ ...days[from], day_number: days[slot].day_number, date: days[slot].date }));
}

/** A plan with its days in the order that keeps its places off their closing days, and what was found. */
export async function keepOffClosingDays<T extends { days: Day[] }>(
  itinerary: T,
  destination: string,
  ask: typeof askClosingDays = askClosingDays
): Promise<{ itinerary: T; costUsd: number; asked: number; shutBefore: number; shutAfter: number }> {
  const places = placesToAsk(itinerary.days);
  const { closings, costUsd } = await ask(destination, places);
  const days = orderAroundClosings(itinerary.days, closings);
  return {
    itinerary: days === itinerary.days ? itinerary : { ...itinerary, days },
    costUsd,
    asked: places.length,
    shutBefore: shutStops(itinerary.days, closings),
    shutAfter: shutStops(days, closings),
  };
}
