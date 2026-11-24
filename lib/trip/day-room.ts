/**
 * Whether a day has room for one more stop, at the stop's own time: what a
 * stop moved off one day (a closing day, an arrival morning) goes into.
 * Pure: used by lib/ai/closing-days.ts and lib/ai/multi-city-core.ts.
 */
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { formatMinutesToTime } from "@/lib/datetime/format";
import { isMealStop } from "@/lib/trip/pace";

export type TimedStop = { name?: string; type?: string; start_time?: string; duration_minutes?: number; time_slot?: string };
type DayOfStops = { activities?: TimedStop[] };
/** What a day that takes one more stop is held to (withStopAt). */
export type RoomRules = {
  /** Its sights stay in the day and its meals near their hours. */
  keepShape?: boolean;
  /** With keepShape: a museum the plan had late in the day may be pushed on, as any evening stop. */
  lateMuseumsMove?: boolean;
};

/** The latest a stop may start once the stops after one moved in make room for it. */
const LATEST_START = 22 * 60;
/**
 * For a caller that asks (keepShape): the latest a sight planned for the day may start once it is pushed, and the
 * latest it may end. Museums, monuments and markets take their last visitors in the late afternoon and shut by the
 * evening. One the plan already had in the evening (a viewpoint at sunset) isn't held to it, unless it is a museum:
 * that one stays where the plan had it rather than going later.
 */
const LATEST_SIGHT_START = 16 * 60 + 30;
const LATEST_SIGHT_END = 18 * 60;
/** Kinds of stop that go on into the evening: a show, a night out, shops, a spa, a ride, the hotel. */
const EVENING_KIND = /entertain|night|show|shopping|spa|wellness|transport|accommodation|hotel|lodging/i;
/** A stop that would be shut by the evening: not a meal, and none of the kinds above. */
const shutByEvening = (stop: TimedStop) => !isMealStop(stop) && !EVENING_KIND.test(stop.type ?? "");
const isMuseum = (stop: TimedStop) => stop.type === "museum";
/** From one stop's end to the next one's start, when a day makes room. */
const BETWEEN_MINUTES = 20;
/** A stop's length when the plan gives none. */
const DEFAULT_MINUTES = 90;
/** How far past its hour a meal may be pushed before it goes ahead of the stop pushing it. */
const MEAL_SLACK_MINUTES = 90;
/** The shortest a visit may be cut to so it fits a slot: an hour, and never under half the visit. */
const SHORTEST_MINUTES = 60;

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Whether a stop is one of the day's sights: it starts by the late afternoon, and would be shut by the evening. */
export const isDaytimeSight = (stop: TimedStop): boolean => {
  const start = minutesOf(stop.start_time);
  return start !== null && start <= LATEST_SIGHT_START && shutByEvening(stop);
};

/** How far apart two stops start, in minutes; no distance when either has no time. */
export const startsApart = (a: TimedStop, b: TimedStop): number => {
  const [one, other] = [minutesOf(a.start_time), minutesOf(b.start_time)];
  return one === null || other === null ? 0 : Math.abs(one - other);
};

/**
 * `stop` with its visit cut to end a short walk before the first of `others` that starts after it, by the evening, and
 * by `closesAt` (minutes after midnight) when its place's closing is known, when it doesn't fit as it is: an hour and
 * half its length at least, in whole five minutes. The stop as it is when it fits; null when it can't.
 */
export function shortenedToFit<S extends TimedStop>(stop: S, others: TimedStop[], closesAt?: number): S | null {
  const start = minutesOf(stop.start_time);
  if (start === null) return null;
  const length = stop.duration_minutes || DEFAULT_MINUTES;
  const after = others.map((other) => minutesOf(other.start_time)).filter((time): time is number => time !== null && time > start);
  const end = Math.min(LATEST_SIGHT_END, closesAt ?? LATEST_SIGHT_END, ...after.map((time) => time - BETWEEN_MINUTES));
  if (start + length <= end) return stop;
  const room = Math.floor((end - start) / 5) * 5;
  return room >= Math.max(SHORTEST_MINUTES, length / 2) ? { ...stop, duration_minutes: room } : null;
}

/** `stop` starting at `opens` (minutes after midnight) when it would start before then; as it is otherwise. */
export function notBefore<S extends TimedStop>(stop: S, opens?: number): S {
  const start = minutesOf(stop.start_time);
  if (opens === undefined || start === null || start >= opens) return stop;
  const time = formatMinutesToTime(opens);
  return { ...stop, start_time: time, time_slot: determineTimeSlot(time) };
}

/** Whether a time given to a sight keeps it in the day: in by the late afternoon, and over by the evening. */
export const keepsToTheDay = (stop: TimedStop): boolean => {
  const start = minutesOf(stop.start_time);
  return start !== null && start <= LATEST_SIGHT_START && start + (stop.duration_minutes || DEFAULT_MINUTES) <= LATEST_SIGHT_END;
};

/**
 * The stops from `at` on, each moved later when it would start before the one
 * ahead of it ends, with a short walk between. Past `through`, the first stop
 * that needn't move ends it: the rest of the day stays as the plan had it.
 * Null when a stop would start after the evening, or a dated event would
 * move; with keepShape, also when a daytime sight, or a museum whatever time
 * the plan gave it (unless `lateMuseumsMove`), would start past the late
 * afternoon or run into the evening.
 */
function makeRoom(stops: TimedStop[], at: number, through: number, { keepShape = false, lateMuseumsMove = false }: RoomRules): TimedStop[] | null {
  const out = [...stops];
  for (let i = Math.max(at, 1); i < out.length; i++) {
    const ahead = out[i - 1];
    const aheadStart = minutesOf(ahead.start_time);
    const start = minutesOf(out[i].start_time);
    if (aheadStart === null || start === null) break;
    const earliest = aheadStart + (ahead.duration_minutes || DEFAULT_MINUTES) + BETWEEN_MINUTES;
    if (start >= earliest) {
      if (i > through) break;
      continue;
    }
    if (earliest > LATEST_START || out[i].type === "event") return null;
    const time = formatMinutesToTime(earliest);
    const held = isDaytimeSight(out[i]) || (!lateMuseumsMove && isMuseum(out[i]));
    if (keepShape && held && !keepsToTheDay({ ...out[i], start_time: time })) return null;
    out[i] = { ...out[i], start_time: time, time_slot: determineTimeSlot(time) };
  }
  return out;
}

/**
 * The day with `stop` put in at its own time, and from there each stop moved
 * later when it would start before the one ahead of it ends, with a short walk
 * between. A meal that would be pushed well past its hour goes ahead of the
 * stops pushing it instead, as few as it takes: lunch between two sights
 * rather than at four. It goes ahead of the stop put in too, when that stop
 * starts at or after the meal's hour anyway. Null when that would start a
 * stop after the evening, or move a dated event: the day has no room. With
 * keepShape, a day also has no room when a daytime sight, the stop put in or
 * one it pushes, would start past the late afternoon or run into the evening,
 * when it would be shut (a museum pushed on, whatever time the plan gave it,
 * unless `lateMuseumsMove`), or when a meal would still be well past its hour.
 * Given `place`, the stop goes in there in the day's order (lunch right after
 * the visit it follows), not by its time.
 */
export function withStopAt<T extends DayOfStops>(day: T, stop: TimedStop, rules: RoomRules = {}, place?: number): T | null {
  const { keepShape = false } = rules;
  let order = [...(day.activities ?? [])];
  const own = minutesOf(stop.start_time);
  const later = order.findIndex((other) => {
    const start = minutesOf(other.start_time);
    return own !== null && start !== null && start > own;
  });
  const at = place ?? (later === -1 ? order.length : later);
  order.splice(at, 0, stop);
  let made = makeRoom(order, at, at, rules);
  if (!made) return null;

  // Where the stop put in is now: a meal that goes ahead of it moves it one place on.
  let put = at;
  let lateMeal = false;
  for (let k = at + 1; k < made.length; k++) {
    const hour = minutesOf(order[k].start_time);
    if (!isMealStop(order[k]) || hour === null) continue;
    const lateBy = (stops: TimedStop[], i: number) => (minutesOf(stops[i].start_time) ?? hour) - hour;
    if (lateBy(made, k) <= MEAL_SLACK_MINUTES) continue;
    // One stop earlier at a time, never past another meal, and past the stop put in only when that stop
    // starts at or after the meal's hour as it is (a dated event it would move leaves no room: makeRoom says so).
    const first = (minutesOf(made[put].start_time) ?? 0) >= hour ? put : put + 1;
    let moved = false;
    for (let j = k - 1; j >= first; j--) {
      if (isMealStop(order[j])) break;
      const tried = [...order];
      const [meal] = tried.splice(k, 1);
      tried.splice(j, 0, meal);
      const room = makeRoom(tried, at, k, rules);
      if (!room) break;
      if (lateBy(room, j) <= MEAL_SLACK_MINUTES) {
        order = tried;
        made = room;
        if (j <= put) put++;
        moved = true;
        break;
      }
    }
    lateMeal ||= !moved;
  }
  if (keepShape && lateMeal) return null;
  return { ...day, activities: made };
}

/** The time a day's stops take, a stop with no length counted as an hour and a half. */
/**
 * For a sight the traveller named that has nowhere else to go: `day` with the stop in the first gap that holds its
 * visit, or an hour and half of it at least, inside its place's `hours` when known, in by the late afternoon and over
 * by the evening, once the stops `mayGo` allows have made way where they stand in it. The ones they didn't ask for give
 * way to the one they did. Null when no gap can be made.
 */
export function withRoomClearedFor<T extends DayOfStops>(
  day: T,
  stop: TimedStop,
  mayGo: (other: TimedStop) => boolean,
  hours?: { open: number; close: number; lastEntry?: number } | null
): T | null {
  const length = stop.duration_minutes || DEFAULT_MINUTES;
  const shortest = Math.max(SHORTEST_MINUTES, length / 2);
  const stops = (day.activities ?? []) as TimedStop[];
  const spanOf = (other: TimedStop): [number, number] | null => {
    const start = minutesOf(other.start_time);
    return start === null ? null : [start, start + (other.duration_minutes || DEFAULT_MINUTES)];
  };
  const fixed = stops.filter((other) => !mayGo(other)).map(spanOf).filter((span): span is [number, number] => span !== null);
  const earliest = hours?.open ?? minutesOf(stop.start_time) ?? 9 * 60;
  const latestStart = Math.min(LATEST_SIGHT_START, hours?.lastEntry ?? LATEST_SIGHT_START);
  const latestEnd = Math.min(LATEST_SIGHT_END, hours?.close ?? LATEST_SIGHT_END);
  const starts = [earliest, ...fixed.map(([, end]) => end + BETWEEN_MINUTES)]
    .filter((start) => start >= earliest && start <= latestStart)
    .sort((a, b) => a - b);
  for (const start of starts) {
    // Not inside a stop that stays, nor too close after it.
    if (fixed.some(([from, to]) => from < start + BETWEEN_MINUTES && to + BETWEEN_MINUTES > start)) continue;
    const next = Math.min(...fixed.map(([from]) => from).filter((from) => from >= start), Infinity);
    const room = Math.floor((Math.min(latestEnd, next - BETWEEN_MINUTES) - start) / 5) * 5;
    const minutes = room >= length ? length : room >= shortest ? room : null;
    if (minutes === null) continue;
    const time = formatMinutesToTime(start);
    const put = { ...stop, start_time: time, time_slot: determineTimeSlot(time), duration_minutes: minutes };
    const kept = stops.filter((other) => {
      if (!mayGo(other)) return true;
      const span = spanOf(other);
      return span === null || span[1] + BETWEEN_MINUTES <= start || span[0] >= start + minutes + BETWEEN_MINUTES;
    });
    const order = [...kept, put].sort((a, b) => (minutesOf(a.start_time) ?? 24 * 60) - (minutesOf(b.start_time) ?? 24 * 60));
    return { ...day, activities: order as T["activities"] };
  }
  return null;
}

export const plannedMinutes = (day: DayOfStops) =>
  (day.activities ?? []).reduce((sum, stop) => sum + (stop.duration_minutes || DEFAULT_MINUTES), 0);
