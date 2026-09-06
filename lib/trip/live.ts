/**
 * Live-trip detection — Live Trip plan, Phase 3.1.
 *
 * Whether a trip is happening right now, and which day it is, computed in the
 * TRIP's timezone rather than the viewer's. A traveller in Tokyo opening a
 * Lisbon trip, or anyone near the date line, must see the right "today"; the
 * whole point of Today mode is that it opens on the correct day.
 *
 * Pure and dependency-free: the IANA zone string arrives already resolved
 * (see lib/trip/timezone.ts, which derives it from coordinates server-side).
 * "Today in a zone" is `Intl.DateTimeFormat` with that `timeZone`, which needs
 * no library on client or server. Everything here is unit-tested for DST and
 * date-line edges.
 */

/** The calendar date (YYYY-MM-DD) it currently is in the given IANA zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA renders ISO-ish YYYY-MM-DD; the timeZone does the actual work.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True when `timeZone` is a zone Intl accepts; false for junk or undefined. */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A trip date column is a plain YYYY-MM-DD (no time, no zone). Take the first 10 chars. */
export function tripDateOnly(value: string): string {
  return value.slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD), UTC-anchored to avoid DST drift. */
export function dayDiff(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export type TripPhase = "upcoming" | "live" | "past" | "unknown";
export type TimezoneSource = "stored" | "derived" | "viewer" | "none";

export interface TripDayState {
  phase: TripPhase;
  isLive: boolean;
  /** 1-based day within the trip when live; the upcoming/past nearest day otherwise; null if unknown. */
  dayNumber: number | null;
  totalDays: number;
  /** Today's date in the resolved zone (YYYY-MM-DD), or null when no usable zone. */
  todayLocalDate: string | null;
  /** Days until the trip starts (>0 upcoming), 0 while live, negative after it ends; null if unknown. */
  daysUntilStart: number | null;
  timeZone: string | null;
  timeZoneSource: TimezoneSource;
}

export interface TripDayStateInput {
  startDate: string; // YYYY-MM-DD (or ISO; only the date part is used)
  endDate: string;
  /** IANA zone already resolved for the trip, or null. */
  timeZone: string | null;
  timeZoneSource?: TimezoneSource;
  /** Fallback zone (the viewer's browser tz) when the trip has none. */
  viewerTimeZone?: string | null;
  now?: Date;
}

/**
 * Resolve the trip's phase and current day.
 *
 * Zone priority: the trip's own zone, else the viewer's (flagged `viewer`),
 * else none — in which case phase is "unknown" and callers show the full
 * itinerary rather than guessing a day.
 */
export function computeTripDayState(input: TripDayStateInput): TripDayState {
  const start = tripDateOnly(input.startDate);
  const end = tripDateOnly(input.endDate);
  const totalDays = Math.max(1, dayDiff(start, end) + 1);

  let timeZone: string | null = null;
  let timeZoneSource: TimezoneSource = "none";
  if (isValidTimeZone(input.timeZone)) {
    timeZone = input.timeZone;
    timeZoneSource = input.timeZoneSource ?? "stored";
  } else if (isValidTimeZone(input.viewerTimeZone)) {
    timeZone = input.viewerTimeZone;
    timeZoneSource = "viewer";
  }

  if (!timeZone) {
    return {
      phase: "unknown",
      isLive: false,
      dayNumber: null,
      totalDays,
      todayLocalDate: null,
      daysUntilStart: null,
      timeZone: null,
      timeZoneSource: "none",
    };
  }

  const today = todayInTimeZone(timeZone, input.now);
  const fromStart = dayDiff(start, today); // >=0 once started
  const daysUntilStart = dayDiff(today, start); // >0 before start

  let phase: TripPhase;
  let dayNumber: number | null;
  if (today < start) {
    phase = "upcoming";
    dayNumber = 1;
  } else if (today > end) {
    phase = "past";
    dayNumber = totalDays;
  } else {
    phase = "live";
    dayNumber = fromStart + 1; // 1-based
  }

  return {
    phase,
    isLive: phase === "live",
    dayNumber,
    totalDays,
    todayLocalDate: today,
    daysUntilStart,
    timeZone,
    timeZoneSource,
  };
}
