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
 *
 * A moved day's words were written for its old date; those that name it are
 * re-worded for the new one (lib/ai/moved-day-words.ts).
 *
 * Some plans have no order that keeps every sight open: on Christmas Day each
 * day may hold a museum shut that day. A stop still shut after the reorder
 * moves on its own to a day it is open, when one has room for it. One with
 * nowhere to go (shut on every date of the trip) is swapped for an open place,
 * when the route asks for that (lib/ai/closed-swaps.ts).
 */
import { withKnownClosings } from "@/lib/ai/known-closings";
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { rewordMovedDays, type WordDay, type WordStop } from "@/lib/ai/moved-day-words";
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { formatMinutesToTime } from "@/lib/datetime/format";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** A place's name, lower-cased, to the weekdays it is shut. */
export type Closings = Map<string, Weekday[]>;
/** A place's name, lower-cased, to the plan's dates (YYYY-MM-DD) it is shut on besides its weekdays. */
export type ShutDates = Map<string, string[]>;

type Day = WordDay;

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

/** Whether a stop is shut on a date: on its weekday, or on that date itself. */
export function stopShutOn(stop: WordStop, date: string | undefined, closings: Closings, shutDates: ShutDates): boolean {
  if (!stop.name) return false;
  const key = placeKey(stop.name);
  const weekday = weekdayOf(date);
  return Boolean((weekday && closings.get(key)?.includes(weekday)) || (date && shutDates.get(key)?.includes(date)));
}

/** How many of a day's stops are shut on a date. */
function shutOn(day: Day, date: string | undefined, closings: Closings, shutDates: ShutDates): number {
  return (day.activities ?? []).filter((stop) => stopShutOn(stop, date, closings, shutDates)).length;
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
 * Where each day's contents go: order[slot] is the day whose contents take
 * that slot's date. The order that leaves the fewest stops on a day they're
 * shut; among orders as good, the one that keeps the first and last days in
 * place, then the one that moves fewest days. A day with a dated event keeps
 * its date.
 */
export function closingOrder(days: Day[], closings: Closings, shutDates: ShutDates = new Map()): number[] {
  if ((closings.size === 0 && shutDates.size === 0) || days.length < 2) return days.map((_, i) => i);
  const shut = days.map((day) => days.map((slot) => shutOn(day, slot.date, closings, shutDates)));
  // A dated event keeps its day, and so does a city's arrival day on a trip through several (its transfer card).
  const movable = days.map(
    (day) => !(day.activities ?? []).some((stop) => stop.type === "event" || (stop as { transport_mode?: string }).transport_mode)
  );
  return days.length <= 7 ? bestOrder(shut, movable) : swappedOrder(shut, movable);
}

/** The days in an order. Each date keeps its place and number; the same array when nothing moves. */
function inOrder<T extends Day>(days: T[], order: number[]): T[] {
  if (order.every((from, slot) => from === slot)) return days;
  return order.map((from, slot) => ({ ...days[from], day_number: days[slot].day_number, date: days[slot].date }));
}

/** The days in their closing order (above). */
export function orderAroundClosings<T extends Day>(days: T[], closings: Closings, shutDates: ShutDates = new Map()): T[] {
  return inOrder(days, closingOrder(days, closings, shutDates));
}

type TimedStop = WordStop & { start_time?: string; duration_minutes?: number; time_slot?: string };

/** The latest a stop may start once the stops after one moved in make room for it. */
const LATEST_START = 22 * 60;
/** From one stop's end to the next one's start, when a day makes room. */
const BETWEEN_MINUTES = 20;
/** A stop's length when the plan gives none. */
const DEFAULT_MINUTES = 90;

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The day with `stop` put in at its own time, and from there each stop moved
 * later when it would start before the one ahead of it ends, with a short walk
 * between. Null when that would start a stop after the evening, or move a
 * dated event: the day has no room.
 */
function withStop<T extends Day>(day: T, stop: TimedStop): T | null {
  const stops = [...((day.activities ?? []) as TimedStop[])];
  const own = minutesOf(stop.start_time);
  const later = stops.findIndex((other) => {
    const start = minutesOf(other.start_time);
    return own !== null && start !== null && start > own;
  });
  const at = later === -1 ? stops.length : later;
  stops.splice(at, 0, stop);
  for (let i = Math.max(at, 1); i < stops.length; i++) {
    const ahead = stops[i - 1];
    const aheadStart = minutesOf(ahead.start_time);
    const start = minutesOf(stops[i].start_time);
    if (aheadStart === null || start === null) break;
    const earliest = aheadStart + (ahead.duration_minutes || DEFAULT_MINUTES) + BETWEEN_MINUTES;
    if (start >= earliest) {
      if (i > at) break;
      continue;
    }
    if (earliest > LATEST_START || stops[i].type === "event") return null;
    const time = formatMinutesToTime(earliest);
    stops[i] = { ...stops[i], start_time: time, time_slot: determineTimeSlot(time) };
  }
  return { ...day, activities: stops };
}

const plannedMinutes = (day: Day) =>
  ((day.activities ?? []) as TimedStop[]).reduce((sum, stop) => sum + (stop.duration_minutes || DEFAULT_MINUTES), 0);

/**
 * The days with each stop still shut on its day moved to another day of the
 * trip when it is open then: of those, the day with the least planned time
 * that has room for it, the nearest first among equals. Only the plan's
 * sights are asked about, so a meal never moves. A stop with nowhere to go
 * stays where it is.
 */
export function moveShutStops<T extends Day>(
  days: T[],
  closings: Closings,
  shutDates: ShutDates
): { days: T[]; moved: number } {
  if ((closings.size === 0 && shutDates.size === 0) || days.length < 2) return { days, moved: 0 };
  let current = days;
  let moved = 0;
  for (let d = 0; d < current.length; d++) {
    let s = 0;
    while (s < (current[d].activities ?? []).length) {
      const stop = (current[d].activities ?? [])[s] as TimedStop;
      if (!stopShutOn(stop, current[d].date, closings, shutDates)) {
        s++;
        continue;
      }
      const options = current
        .map((day, i) => ({ day, i }))
        .filter(({ day, i }) => i !== d && day.date !== undefined && !stopShutOn(stop, day.date, closings, shutDates))
        .sort((a, b) => plannedMinutes(a.day) - plannedMinutes(b.day) || Math.abs(a.i - d) - Math.abs(b.i - d));
      let target: { i: number; day: T } | null = null;
      for (const option of options) {
        const day = withStop(option.day, stop);
        if (day) {
          target = { i: option.i, day };
          break;
        }
      }
      if (!target) {
        s++;
        continue;
      }
      const into = target;
      const from = { ...current[d], activities: (current[d].activities ?? []).filter((_, k) => k !== s) };
      current = current.map((day, k) => (k === d ? from : k === into.i ? into.day : day));
      moved++;
    }
  }
  return { days: current, moved };
}

/** A stop still shut on its own day once the days were ordered and stops moved: nowhere open could take it. */
export interface StuckStop {
  /** The day it is on. */
  day: number;
  date: string;
  name: string;
  start_time?: string;
  duration_minutes?: number;
}

/** The stops shut on their own day, in plan order. */
export function stopsStillShut(days: Day[], closings: Closings, shutDates: ShutDates): StuckStop[] {
  return days.flatMap((day) =>
    (day.activities ?? []).flatMap((stop) => {
      const { start_time, duration_minutes } = stop as TimedStop;
      return day.date && typeof day.day_number === "number" && stop.name && stopShutOn(stop, day.date, closings, shutDates)
        ? [{ day: day.day_number, date: day.date, name: stop.name, start_time, duration_minutes }]
        : [];
    })
  );
}

/** Swaps stuck stops for open places (lib/ai/closed-swaps.ts): the days, how many went in, and what it cost. */
export type SwapStuck = (days: Day[], stuck: StuckStop[]) => Promise<{ days: Day[]; swapped: number; costUsd: number }>;

/**
 * A plan with its days in the order that keeps its places off their closing
 * days, the moved days' words that name their old date re-worded, a stop still
 * shut moved to a day it is open, one with nowhere to go swapped for an open
 * place when `swap` is given, and what was found.
 */
export async function keepOffClosingDays<T extends { days: Day[] }>(
  itinerary: T,
  destination: string,
  ask: typeof askClosingDays = askClosingDays,
  reword: typeof rewordMovedDays = rewordMovedDays,
  swap?: SwapStuck,
  checked: typeof withKnownClosings = withKnownClosings
): Promise<{
  itinerary: T;
  costUsd: number;
  asked: number;
  /** Stops whose closing days came from the checked list. */
  known: number;
  shutBefore: number;
  shutAfter: number;
  /** The stops still on a day they're shut at the end, as "name (date)": what a miss was. */
  leftShut: string[];
  reworded: number;
  stopsMoved: number;
  swapped: number;
}> {
  const places = placesToAsk(itinerary.days);
  const answer = await ask(destination, places, holidayDatesToAsk(itinerary.days));
  // The sights on the checked list are decided by it, not by the model (lib/ai/known-closings.ts).
  const { closings, shutDates, known } = checked(answer, itinerary.days, destination);
  const settled = await settleDays(itinerary.days, closings, shutDates, destination, reword, swap);
  return report(itinerary, settled, answer.costUsd, places.length, known, closings, shutDates);
}

type Settled<D> = { days: D[]; costUsd: number; reworded: number; stopsMoved: number; swapped: number };

/** Days put in their closing order, moved days re-worded, stops still shut moved or swapped: the steps after the question. */
async function settleDays<D extends Day>(
  days: D[],
  closings: Closings,
  shutDates: ShutDates,
  destination: string,
  reword: typeof rewordMovedDays,
  swap?: SwapStuck
): Promise<Settled<D>> {
  const order = closingOrder(days, closings, shutDates);
  const moves = order.flatMap((from, slot) => (from === slot ? [] : [{ slot, from: days[from].date }]));
  const ordered = inOrder(days, order);
  const words = moves.length > 0 ? await reword(ordered, moves, destination) : { days: ordered, costUsd: 0, reworded: 0 };
  const stops = moveShutStops(words.days, closings, shutDates);
  const stuck = swap ? stopsStillShut(stops.days, closings, shutDates) : [];
  const swaps = swap && stuck.length > 0 ? await swap(stops.days, stuck) : { days: stops.days, swapped: 0, costUsd: 0 };
  return { days: swaps.days as D[], costUsd: words.costUsd + swaps.costUsd, reworded: words.reworded, stopsMoved: stops.moved, swapped: swaps.swapped };
}

/** What keepOffClosingDays and keepOffClosingDaysByCity give back. */
function report<T extends { days: Day[] }>(
  itinerary: T,
  settled: Settled<Day>,
  askedUsd: number,
  asked: number,
  known: number,
  closings: Closings,
  shutDates: ShutDates
) {
  const days = settled.days;
  return {
    itinerary: days === itinerary.days ? itinerary : { ...itinerary, days },
    costUsd: askedUsd + settled.costUsd,
    asked,
    known,
    shutBefore: shutStops(itinerary.days, closings, shutDates),
    shutAfter: shutStops(days, closings, shutDates),
    leftShut: stopsStillShut(days, closings, shutDates).map((stop) => `${stop.name} (${stop.date})`),
    reworded: settled.reworded,
    stopsMoved: settled.stopsMoved,
    swapped: settled.swapped,
  };
}

/** The runs of days in one city, in order; days with no city run as one. */
function cityRuns<D extends Day>(days: D[]): Array<{ city: string; days: D[] }> {
  const runs: Array<{ city: string; days: D[] }> = [];
  for (const day of days) {
    const city = (day as { city?: string }).city ?? "";
    const last = runs.at(-1);
    if (last && last.city === city) last.days.push(day);
    else runs.push({ city, days: [day] });
  }
  return runs;
}

/**
 * keepOffClosingDays for a trip through several cities: one question for all its places, then each city's own days
 * put in order, re-worded, and its stops moved or swapped there, so a place never goes to another city and the
 * route keeps its days. A city's arrival day (its transfer card) keeps its date. `swapIn` gives the swap for a city.
 */
export async function keepOffClosingDaysByCity<T extends { days: Day[] }>(
  itinerary: T,
  destination: string,
  ask: typeof askClosingDays = askClosingDays,
  reword: typeof rewordMovedDays = rewordMovedDays,
  swapIn?: (city: string) => SwapStuck,
  checked: typeof withKnownClosings = withKnownClosings
): ReturnType<typeof keepOffClosingDays<T>> {
  const places = placesToAsk(itinerary.days);
  const answer = await ask(destination, places, holidayDatesToAsk(itinerary.days));
  const { closings, shutDates, known } = checked(answer, itinerary.days, destination);
  const parts = cityRuns(itinerary.days);
  const runs = await Promise.all(
    parts.map((part) => settleDays(part.days, closings, shutDates, part.city || destination, reword, swapIn?.(part.city || destination)))
  );
  // Settling returns a city's own days when nothing in them moved.
  const changed = runs.some((run, i) => run.days !== parts[i].days);
  const settled: Settled<Day> = {
    days: changed ? runs.flatMap((run) => run.days) : itinerary.days,
    costUsd: runs.reduce((sum, run) => sum + run.costUsd, 0),
    reworded: runs.reduce((sum, run) => sum + run.reworded, 0),
    stopsMoved: runs.reduce((sum, run) => sum + run.stopsMoved, 0),
    swapped: runs.reduce((sum, run) => sum + run.swapped, 0),
  };
  return report(itinerary, settled, answer.costUsd, places.length, known, closings, shutDates);
}
