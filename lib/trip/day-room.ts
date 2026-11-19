/**
 * Whether a day has room for one more stop, at the stop's own time: what a
 * stop moved off one day (a closing day, an arrival morning) goes into.
 * Pure: used by lib/ai/closing-days.ts and lib/ai/multi-city-core.ts.
 */
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { formatMinutesToTime } from "@/lib/datetime/format";

export type TimedStop = { name?: string; type?: string; start_time?: string; duration_minutes?: number; time_slot?: string };
type DayOfStops = { activities?: TimedStop[] };

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
export function withStopAt<T extends DayOfStops>(day: T, stop: TimedStop): T | null {
  const stops = [...(day.activities ?? [])];
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

/** The time a day's stops take, a stop with no length counted as an hour and a half. */
export const plannedMinutes = (day: DayOfStops) =>
  (day.activities ?? []).reduce((sum, stop) => sum + (stop.duration_minutes || DEFAULT_MINUTES), 0);
