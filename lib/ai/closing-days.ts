/**
 * Plans put sights on days they're shut. Writing a whole plan, the model gets
 * weekly closing days wrong that it gets right when asked about one place at a
 * time. So once a plan is written, one short question asks on which weekdays
 * each of its sights, markets, gardens and shops is shut, and the days are put in the order
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
 * moves on its own to a day it is open, when one has room for it in the day,
 * or trades days with a sight of that day. One the traveller asked for by name
 * takes the place of a sight they didn't, when nothing else gets it to a day
 * it is open. One with nowhere to go (shut on every date of the trip, or every
 * open day full) is swapped for an open place, when the route asks for that
 * (lib/ai/closed-swaps.ts).
 */
import { easterSunday } from "@/lib/ai/easter";
import { withClosingNotes, withKnownClosings, type OpenHours } from "@/lib/ai/known-closings";
import { insideHours, knownHoursFor } from "@/lib/ai/visit-hours";
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { rewordMovedDays, type WordDay, type WordStop } from "@/lib/ai/moved-day-words";
import {
  isDaytimeSight,
  keepsToTheDay,
  plannedMinutes,
  shortenedToFit,
  startsApart,
  withStopAt,
  type TimedStop as DayRoomStop,
} from "@/lib/trip/day-room";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** A place's name, lower-cased, to the weekdays it is shut. */
export type Closings = Map<string, Weekday[]>;
/** A place's name, lower-cased, to the plan's dates (YYYY-MM-DD) it is shut on besides its weekdays. */
export type ShutDates = Map<string, string[]>;

type Day = WordDay;

/**
 * The kinds of stop asked about. Gardens close on holidays (a botanical garden on Christmas Day) and so do shops (a
 * department store on New Year's Day); open-air parks come back open. Nature stops (a hike, a waterfall) are open,
 * but a garden, zoo or aquarium can come typed as one too: those are asked by their name.
 */
const ASKED = new Set(["museum", "landmark", "attraction", "market", "entertainment", "tour", "spa", "activity", "park", "shopping"]);
/** A name with gates and opening days, without accents, lower case: a botanical garden, a zoo, an aquarium. */
const GATED = /\b(?:botani\w*|gardens?|jardin\w*|giardin\w*|jardim\w*|\w*garten|gyoen|zoo|zoolog\w*|ac?quari\w*|arboret\w*|conservator\w*|hortus)\b/;
const isAsked = (stop: { name?: string; type?: string }): boolean =>
  ASKED.has(String(stop.type)) ||
  (stop.type === "nature" && GATED.test((stop.name ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()));
/** At most this many places in one question. */
const MAX_PLACES = 40;
const TIMEOUT_MS = 5000;

const placeKey = (name: string) => name.trim().toLowerCase();

/** The plan's sights, markets, parks and shops, each once, in plan order. */
export function placesToAsk(days: Day[]): string[] {
  const places = new Map<string, string>();
  for (const day of days) {
    for (const stop of day.activities ?? []) {
      const name = stop.name?.trim();
      if (name && isAsked(stop) && !places.has(placeKey(name))) places.set(placeKey(name), name);
    }
  }
  return [...places.values()].slice(0, MAX_PLACES);
}

/**
 * The plan's dates on which sights close for a holiday whatever their weekday:
 * Christmas to Epiphany, the first of May, Easter Sunday (the Western and the
 * Orthodox one: the Acropolis shuts on Greece's) and Thanksgiving (the fourth
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
  const [month, dom] = [Number(m[2]), Number(m[3])];
  return (month === 12 && dom >= 24) || (month === 1 && dom <= 6) || holidayName(date) !== null;
}

const NAMED_DAYS: Record<string, string> = {
  "12-24": "Christmas Eve",
  "12-25": "Christmas Day",
  "12-26": "St Stephen's Day",
  "12-31": "New Year's Eve",
  "01-01": "New Year's Day",
  "01-06": "Epiphany",
  "05-01": "May Day",
};

/**
 * The holiday a date is, as the question names it: told only the date and its weekday, the model passes over closures
 * it knows (a museum shut on Christmas Day). None for the days between (27 to 30 December, 2 to 5 January).
 */
function holidayName(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  if (date === easterSunday(year, "western")) return "Easter Sunday";
  if (date === easterSunday(year, "orthodox")) return "Orthodox Easter Sunday";
  const firstThursday = ((4 - new Date(Date.UTC(year, 10, 1)).getUTCDay() + 7) % 7) + 1;
  if (m[2] === "11" && Number(m[3]) === firstThursday + 21) return "Thanksgiving Day in the United States";
  return NAMED_DAYS[`${m[2]}-${m[3]}`] ?? null;
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
            .map((date) => `${date} (${[weekdayOf(date), holidayName(date)].filter(Boolean).join(", ")})`)
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

type TimedStop = WordStop & DayRoomStop;

/**
 * A day takes a moved sight only while it keeps its shape: its daytime sights in the day (a museum pushed to the
 * evening is shut) and its meals near their hours.
 */
const KEEPS_SHAPE = { keepShape: true };

/** A stop that may change days to make room: one of the day's sights, not a dated event or a fixed plan. */
const mayChangeDay = (stop: TimedStop) => isDaytimeSight(stop) && stop.type !== "event" && !(stop as { locked?: boolean }).locked;

/** No stop was named by the traveller. */
const NONE_NAMED = () => false;

/** The hours a stop's place keeps on a date, when the checked list knows them (lib/ai/visit-hours.ts). */
type HoursOn = (stop: TimedStop, date: string | undefined) => OpenHours | null;
const NO_HOURS: HoursOn = () => null;

/** Whether a stop at its time keeps inside the hours its place keeps on a date: any time does when they aren't known. */
function inItsHours(stop: TimedStop, date: string | undefined, hoursOn: HoursOn): boolean {
  const m = /^(\d{1,2}):(\d{2})/.exec(stop.start_time ?? "");
  return !m || insideHours(Number(m[1]) * 60 + Number(m[2]), stop.duration_minutes || 90, hoursOn(stop, date));
}

/** How many of a day's stops start later once one more was put in. */
const startLater = (before: Day, after: Day) => (after.activities ?? []).filter((stop) => !(before.activities ?? []).includes(stop)).length - 1;

/**
 * `home`'s stop at `at` and a sight of `away` trading places, when `away` has no room for the stop as it is: each
 * takes the other's time on the other's day. Of the sights that `give` their place and make both days work, the one
 * whose trade moves the fewest other stops goes, the nearest in time to the stop among equals: a morning sight stays
 * a morning sight where it can. Only a sight of the day trades, at times that keep both in the day, so an evening
 * stop never trades with a morning one, and neither lands outside the hours its place keeps that day (`hoursOn`).
 * With `fit`, the stop's visit is cut to the slot it takes when it is longer (shortenedToFit), so it pushes none of
 * the stops after it and ends by its place's closing. None when no sight does.
 */
function tradedDays<T extends Day>(
  home: T,
  at: number,
  away: T,
  gives: (other: TimedStop) => boolean,
  { fit = false, hoursOn = NO_HOURS }: { fit?: boolean; hoursOn?: HoursOn } = {}
): { from: T; into: T } | null {
  const stop = (home.activities ?? [])[at] as TimedStop;
  const rest = { ...home, activities: (home.activities ?? []).filter((_, k) => k !== at) };
  const others = (away.activities ?? [])
    .map((other, k) => ({ other: other as TimedStop, k }))
    .sort((a, b) => startsApart(a.other, stop) - startsApart(b.other, stop));
  let best: { from: T; into: T; later: number } | null = null;
  for (const { other, k } of others) {
    const moved = { ...other, start_time: stop.start_time, time_slot: stop.time_slot };
    const without = { ...away, activities: (away.activities ?? []).filter((_, j) => j !== k) };
    const whole = { ...stop, start_time: other.start_time, time_slot: other.time_slot };
    const placed = fit && isDaytimeSight(whole) ? shortenedToFit(whole, without.activities ?? [], hoursOn(whole, away.date)?.close) : whole;
    if (!placed || !mayChangeDay(other) || !gives(other) || !keepsToTheDay(moved) || (isDaytimeSight(placed) && !keepsToTheDay(placed))) continue;
    if (!inItsHours(placed, away.date, hoursOn) || !inItsHours(moved, home.date, hoursOn)) continue;
    const into = withStopAt(without, placed, KEEPS_SHAPE);
    const from = into && withStopAt(rest, moved, KEEPS_SHAPE);
    if (!into || !from) continue;
    const later = startLater(without, into) + startLater(rest, from);
    if (!best || later < best.later) best = { from, into, later };
    if (later === 0) break;
  }
  return best && { from: best.from, into: best.into };
}

/**
 * The days with each stop still shut on its day moved to another day of the
 * trip when it is open then: of those, the day with the least planned time
 * that has room for it, the nearest first among equals. A day has room while
 * it keeps its shape; when none has, the stop trades places with a sight of a
 * day it is open on, one that is open on the stop's own day (tradedDays).
 * A stop the traveller `named` (a must-do) is never the sight that gives its
 * place, and when nothing else gets it to a day it is open, it takes the place
 * of a sight they didn't ask for, which then stands on a day it may be shut:
 * better that one swapped for an open place than the one they named. When no
 * slot takes its whole visit, it is cut to the slot it takes, never under an
 * hour or half its visit: a shorter visit to a sight they asked for beats none.
 * No trade puts a sight outside the hours its place keeps that day, when the
 * checked list knows them (`hoursOn`). Only
 * the plan's sights are asked about, so a meal never moves. A stop with
 * nowhere to go stays where it is. A trip needs no more moves than it has
 * stops: past that count nothing moves.
 */
export function moveShutStops<T extends Day>(
  days: T[],
  closings: Closings,
  shutDates: ShutDates,
  named: (stop: TimedStop) => boolean = NONE_NAMED,
  hoursOn: HoursOn = NO_HOURS
): { days: T[]; moved: number } {
  if ((closings.size === 0 && shutDates.size === 0) || days.length < 2) return { days, moved: 0 };
  let current = days;
  let moved = 0;
  const most = days.reduce((sum, day) => sum + (day.activities ?? []).length, 0);
  for (let d = 0; d < current.length; d++) {
    let s = 0;
    while (s < (current[d].activities ?? []).length) {
      const stop = (current[d].activities ?? [])[s] as TimedStop;
      if (moved >= most || !stopShutOn(stop, current[d].date, closings, shutDates)) {
        s++;
        continue;
      }
      const options = current
        .map((day, i) => ({ day, i }))
        .filter(({ day, i }) => i !== d && day.date !== undefined && !stopShutOn(stop, day.date, closings, shutDates))
        .sort((a, b) => plannedMinutes(a.day) - plannedMinutes(b.day) || Math.abs(a.i - d) - Math.abs(b.i - d));
      let target: { i: number; into: T; from: T } | null = null;
      for (const option of options) {
        const into = withStopAt(option.day, stop, KEEPS_SHAPE);
        if (into) {
          target = { i: option.i, into, from: { ...current[d], activities: (current[d].activities ?? []).filter((_, k) => k !== s) } };
          break;
        }
      }
      const home = current[d];
      for (const option of target ? [] : options) {
        const trade = tradedDays(home, s, option.day, (other) => !named(other) && !stopShutOn(other, home.date, closings, shutDates), { hoursOn });
        if (trade) {
          target = { i: option.i, ...trade };
          break;
        }
      }
      // Its whole visit on any open day first; cut to a slot only when none takes it.
      for (const fit of target || !named(stop) ? [] : [false, true]) {
        for (const option of options) {
          const trade = tradedDays(home, s, option.day, (other) => !named(other), { fit, hoursOn });
          if (trade) {
            target = { i: option.i, ...trade };
            break;
          }
        }
        if (target) break;
      }
      if (!target) {
        s++;
        continue;
      }
      const { i, into, from } = target;
      current = current.map((day, k) => (k === d ? from : k === i ? into : day));
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
  checked: typeof withKnownClosings = withKnownClosings,
  /** Tells the stops the traveller asked for by name (lib/ai/must-dos.ts askedByName): they keep a day they are open. */
  named?: (stop: WordStop) => boolean
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
  const settled = await settleDays(itinerary.days, closings, shutDates, destination, reword, swap, named);
  return report(itinerary, settled, answer.costUsd, places.length, known, closings, shutDates, destination);
}

type Settled<D> = { days: D[]; costUsd: number; reworded: number; stopsMoved: number; swapped: number };

/** Days put in their closing order, moved days re-worded, stops still shut moved or swapped: the steps after the question. */
async function settleDays<D extends Day>(
  days: D[],
  closings: Closings,
  shutDates: ShutDates,
  destination: string,
  reword: typeof rewordMovedDays,
  swap?: SwapStuck,
  named?: (stop: WordStop) => boolean
): Promise<Settled<D>> {
  const order = closingOrder(days, closings, shutDates);
  const moves = order.flatMap((from, slot) => (from === slot ? [] : [{ slot, from: days[from].date }]));
  const ordered = inOrder(days, order);
  const words = moves.length > 0 ? await reword(ordered, moves, destination) : { days: ordered, costUsd: 0, reworded: 0 };
  // A trade keeps each sight inside the hours the checked list knows for it, in this city.
  const stops = moveShutStops(words.days, closings, shutDates, named, (stop, date) => (date ? knownHoursFor(stop.name, destination, date) : null));
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
  shutDates: ShutDates,
  destination: string
) {
  // Each listed place shut on a date of the trip says so on the stop, with its official page.
  const days = withClosingNotes(settled.days, destination);
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
  checked: typeof withKnownClosings = withKnownClosings,
  named?: (stop: WordStop) => boolean
): ReturnType<typeof keepOffClosingDays<T>> {
  const places = placesToAsk(itinerary.days);
  const answer = await ask(destination, places, holidayDatesToAsk(itinerary.days));
  const { closings, shutDates, known } = checked(answer, itinerary.days, destination);
  const parts = cityRuns(itinerary.days);
  const runs = await Promise.all(
    parts.map((part) => settleDays(part.days, closings, shutDates, part.city || destination, reword, swapIn?.(part.city || destination), named))
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
  return report(itinerary, settled, answer.costUsd, places.length, known, closings, shutDates, destination);
}
