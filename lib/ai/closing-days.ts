/**
 * Plans put sights on days they're shut. Writing a whole plan, the model gets
 * weekly closing days wrong that it gets right when asked about one place at a
 * time. So once a plan is written, one short question asks on which weekdays
 * each of its sights and markets is shut, and the days are put in the order
 * that leaves the fewest of them on such a day. Each date keeps its place and
 * number; the days' contents move. Meals are not asked about: the model's word
 * on a restaurant's closing day is unreliable.
 *
 * Holidays close sights whatever their weekday, and a plan puts them there even
 * when told the holiday (the Louvre on Christmas Day, the Statue of Liberty on
 * Thanksgiving). So the same question also asks which of the plan's holiday
 * dates each place is shut on.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** A place's name, lower-cased, to the weekdays it is shut. */
export type Closings = Map<string, Weekday[]>;
/** A place's name, lower-cased, to the plan's dates (YYYY-MM-DD) it is shut on besides its weekdays. */
export type ShutDates = Map<string, string[]>;

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

/**
 * The plan's dates on which sights close for a holiday whatever their weekday:
 * Christmas to Epiphany, the first of May, and Thanksgiving (the fourth
 * Thursday of November). Each is asked about by its date.
 */
export function holidayDatesToAsk(days: Day[]): string[] {
  const dates = new Set<string>();
  for (const day of days) if (day.date && isHolidayDate(day.date)) dates.add(day.date);
  return [...dates];
}

function isHolidayDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [year, month, dom] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if ((month === 12 && dom >= 24) || (month === 1 && dom <= 6) || (month === 5 && dom === 1)) return true;
  if (month !== 11) return false;
  const firstThursday = ((4 - new Date(Date.UTC(year, 10, 1)).getUTCDay() + 7) % 7) + 1;
  return dom === firstThursday + 21;
}

function schemaFor(dates: string[]): ResponseSchema {
  return {
    type: SchemaType.OBJECT,
    properties: {
      places: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            n: { type: SchemaType.INTEGER },
            closed: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING, enum: [...WEEKDAYS] } },
            ...(dates.length > 0 ? { shutOn: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING, enum: dates } } } : {}),
          },
          required: ["n", "closed"],
        },
      },
    },
    required: ["places"],
  };
}

/**
 * Each place's weekly closing days, and which of the given holiday dates it is
 * shut on. None when there is no key, or the question fails or takes too
 * long: the plan then keeps its order. The cost goes to the running request's
 * meter, and is returned for a route that sums its own.
 */
export async function askClosingDays(
  destination: string,
  places: string[],
  dates: string[] = []
): Promise<{ closings: Closings; shutDates: ShutDates; costUsd: number }> {
  const closings: Closings = new Map();
  const shutDates: ShutDates = new Map();
  if (places.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { closings, shutDates, costUsd: 0 };
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schemaFor(dates),
      maxOutputTokens: 2048,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  const question = [
    `On which days of the week is each of these places in ${destination} closed to visitors, every week? Leave out public holidays and seasonal closures. A place open every day has an empty list.`,
    ...(dates.length > 0
      ? [
          `Also, in "shutOn", the dates among these on which each place is closed to visitors, for a holiday or any other reason: ${dates
            .map((date) => `${date} (${weekdayOf(date)})`)
            .join(", ")}. Leave out a date when it is open that day.`,
        ]
      : []),
    ...places.map((place, i) => `${i + 1}. ${place}`),
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Closing days");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    const answer = JSON.parse(result.response.text()) as {
      places?: Array<{ n?: unknown; closed?: unknown; shutOn?: unknown }>;
    };
    for (const entry of answer.places ?? []) {
      const place = typeof entry.n === "number" ? places[entry.n - 1] : undefined;
      if (!place) continue;
      const days = Array.isArray(entry.closed)
        ? WEEKDAYS.filter((weekday) => (entry.closed as unknown[]).includes(weekday))
        : [];
      if (days.length > 0) closings.set(placeKey(place), days);
      const shut = Array.isArray(entry.shutOn) ? dates.filter((date) => (entry.shutOn as unknown[]).includes(date)) : [];
      if (shut.length > 0) shutDates.set(placeKey(place), shut);
    }
    return { closings, shutDates, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[closing-days] not checked:", err instanceof Error ? err.message : String(err));
    return { closings: new Map(), shutDates: new Map(), costUsd: 0 };
  }
}

const weekdayOf = (date?: string): Weekday | null =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] : null;

/** How many of a day's stops are shut on a date: on its weekday, or on that date itself. */
function shutOn(day: Day, date: string | undefined, closings: Closings, shutDates: ShutDates): number {
  const weekday = weekdayOf(date);
  return (day.activities ?? []).filter((stop) => {
    if (!stop.name) return false;
    const key = placeKey(stop.name);
    return Boolean((weekday && closings.get(key)?.includes(weekday)) || (date && shutDates.get(key)?.includes(date)));
  }).length;
}

/** How many of the days' stops fall on a day they're shut. */
export function shutStops(days: Day[], closings: Closings, shutDates: ShutDates = new Map()): number {
  return days.reduce((sum, day) => sum + shutOn(day, day.date, closings, shutDates), 0);
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
export function orderAroundClosings<T extends Day>(days: T[], closings: Closings, shutDates: ShutDates = new Map()): T[] {
  if ((closings.size === 0 && shutDates.size === 0) || days.length < 2) return days;
  const shut = days.map((day) => days.map((slot) => shutOn(day, slot.date, closings, shutDates)));
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
  const { closings, shutDates, costUsd } = await ask(destination, places, holidayDatesToAsk(itinerary.days));
  const days = orderAroundClosings(itinerary.days, closings, shutDates);
  return {
    itinerary: days === itinerary.days ? itinerary : { ...itinerary, days },
    costUsd,
    asked: places.length,
    shutBefore: shutStops(itinerary.days, closings, shutDates),
    shutAfter: shutStops(days, closings, shutDates),
  };
}
