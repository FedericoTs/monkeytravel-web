/**
 * A plan times each visit by its place in the day, not by the place's hours: a Tokyo garden that shuts at four in
 * winter gets the afternoon slot, half past two to half past four. For the places whose hours the checked list holds
 * (lib/ai/known-closings.ts), a visit that would run past closing, start after the last entry or start before opening
 * trades slots with another sight of the same day, when both then fit their hours and neither runs into the stop after
 * it. Failing that, one that starts in time but runs past closing is cut to end at closing, when an hour and half the
 * visit are left. Otherwise it stays, and the plan's log names it.
 */
import { hoursOn, knownClosingFor, type OpenHours } from "@/lib/ai/known-closings";
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { isMealStop } from "@/lib/trip/pace";

type Stop = {
  name?: string;
  type?: string;
  start_time?: string;
  duration_minutes?: number;
  time_slot?: string;
  locked?: boolean;
};
type Day = { date?: string; city?: string; activities?: Stop[] };

/** A stop's length when the plan gives none. */
const DEFAULT_MINUTES = 90;
/** The shortest visit worth keeping when one is cut to end at closing. */
const SHORTEST_MINUTES = 60;

/** The kinds of stop that may take another slot of their day: sights, not meals, rides, shows or shops. */
const MOVABLE = new Set(["attraction", "landmark", "museum", "cultural", "historical", "park", "nature", "religious"]);
/**
 * Words that tie a stop to its hour of the day, in the plans' languages. Such a stop never trades slots, and its own
 * hours aren't checked: a temple's autumn night opening keeps its evening.
 */
const TIED_TO_HOUR =
  /\b(?:sunset|sunrise|night|evening|dusk|dawn|illuminations?|light[- ]?up|tramonto|alba|notte|sera|serale|illuminazione|atardecer|amanecer|noche|nocturn[ao]|iluminaci[oó]n|p[oô]r do sol|nascer do sol|noite|noturn[ao]|ilumina[cç][aã]o)\b/i;

/** The hours a stop's place keeps on a date, or none known. */
export type HoursFor = (name: string | undefined, destination: string, date: string) => OpenHours | null;

/** The checked list's hours. */
export const knownHoursFor: HoursFor = (name, destination, date) => {
  const entry = knownClosingFor(name, destination);
  return entry ? hoursOn(entry, date) : null;
};

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const lengthOf = (stop: Stop) => stop.duration_minutes || DEFAULT_MINUTES;

/** Whether a visit from `start` (minutes after midnight) lasting `minutes` keeps inside the hours. */
export function insideHours(start: number, minutes: number, hours: OpenHours | null): boolean {
  if (!hours) return true;
  return start >= hours.open && start <= (hours.lastEntry ?? hours.close) && start + minutes <= hours.close;
}

/** The stops with the ones at `a` and `b` trading slots: each takes the other's place in the day and its start time. */
function traded(stops: Stop[], a: number, b: number): Stop[] {
  const at = (stop: Stop, time: string | undefined): Stop =>
    time ? { ...stop, start_time: time, time_slot: determineTimeSlot(time) } : stop;
  const out = [...stops];
  out[a] = at(stops[b], stops[a].start_time);
  out[b] = at(stops[a], stops[b].start_time);
  return out;
}

/**
 * Whether the stop at `i` ends by the time the next one starts. Checked at both slots of a trade, this covers the
 * stops before them too: the one before a slot is either untouched or the other side of the trade.
 */
function endsInTime(stops: Stop[], i: number): boolean {
  const start = minutesOf(stops[i].start_time);
  const next = stops[i + 1];
  const nextStart = next ? minutesOf(next.start_time) : null;
  return start !== null && !(next && nextStart !== null && start + lengthOf(stops[i]) > nextStart);
}

/**
 * The sight of the same day whose slot the stop at `i` can take, giving it the stop's own: both inside their hours
 * there, clear of the stops around them. The nearest in the day when several can.
 */
function tradeFor(stops: Stop[], i: number, hours: OpenHours, place: string, date: string, hoursFor: HoursFor): number | null {
  const stop = stops[i];
  const start = minutesOf(stop.start_time);
  if (start === null) return null;
  let best: number | null = null;
  for (let j = 0; j < stops.length; j++) {
    const other = stops[j];
    if (j === i || !MOVABLE.has(other.type ?? "") || other.locked || TIED_TO_HOUR.test(other.name ?? "")) continue;
    const otherStart = minutesOf(other.start_time);
    if (otherStart === null) continue;
    if (!insideHours(otherStart, lengthOf(stop), hours)) continue;
    if (!insideHours(start, lengthOf(other), hoursFor(other.name, place, date))) continue;
    const after = traded(stops, i, j);
    if (!endsInTime(after, i) || !endsInTime(after, j)) continue;
    if (best === null || Math.abs(j - i) < Math.abs(best - i)) best = j;
  }
  return best;
}

export interface InsideHours<T> {
  days: T[];
  /** Visits to places whose hours are known. */
  checked: number;
  /** Of those, the ones the plan had outside their place's hours. */
  outside: number;
  /** Visits that traded slots with another sight of their day. */
  moved: number;
  /** Visits cut to end at closing. */
  shortened: number;
  /** The visits still outside their hours, as "name (date time)": what a miss was. */
  left: string[];
}

/** The days with each visit to a place of known hours kept inside them where the day allows it. */
export function keepInsideHours<T extends Day>(days: T[], destination: string, hoursFor: HoursFor = knownHoursFor): InsideHours<T> {
  let checked = 0;
  let outside = 0;
  let moved = 0;
  let shortened = 0;
  const left: string[] = [];
  const out = days.map((day) => {
    const date = day.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !day.activities?.length) return day;
    // A multi-city trip's day names its own city: a "Pantheon" in Paris isn't Rome's.
    const place = day.city || destination;
    // A meal is never the place it is named after ("Armando al Pantheon" is a restaurant), and a booked commitment
    // or a stop named for its hour keeps its time.
    const checkedHere = (stop: Stop) => !stop.locked && !isMealStop(stop) && !TIED_TO_HOUR.test(stop.name ?? "");
    for (const stop of day.activities) {
      const hours = checkedHere(stop) ? hoursFor(stop.name, place, date) : null;
      const start = minutesOf(stop.start_time);
      if (!hours || start === null) continue;
      checked++;
      if (!insideHours(start, lengthOf(stop), hours)) outside++;
    }
    // A visit that trades slots lands inside its hours, and so does the sight it trades with: neither is looked at again.
    let stops = [...day.activities];
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (!checkedHere(stop)) continue;
      const hours = hoursFor(stop.name, place, date);
      const start = minutesOf(stop.start_time);
      if (!hours || start === null || insideHours(start, lengthOf(stop), hours)) continue;
      const j = tradeFor(stops, i, hours, place, date, hoursFor);
      if (j !== null) {
        stops = traded(stops, i, j);
        moved++;
        continue;
      }
      const toClosing = hours.close - start;
      const startsInTime = start >= hours.open && start <= (hours.lastEntry ?? hours.close);
      if (startsInTime && toClosing >= SHORTEST_MINUTES && toClosing * 2 >= lengthOf(stop)) {
        stops[i] = { ...stop, duration_minutes: toClosing };
        shortened++;
        continue;
      }
      left.push(`${stop.name} (${date} ${stop.start_time})`);
    }
    return stops.every((stop, k) => stop === day.activities?.[k]) ? day : { ...day, activities: stops };
  });
  return { days: out, checked, outside, moved, shortened, left };
}
