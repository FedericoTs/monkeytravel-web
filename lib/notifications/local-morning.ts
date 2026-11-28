import { parseDigestDay } from "@/lib/notifications/digest";
import { isPreTripSlot } from "@/lib/notifications/queue";
import { deriveTimezoneFromItinerary } from "@/lib/trip/timezone";
import { todayInTimeZone } from "@/lib/trip/live";
import type { ItineraryDay } from "@/types";

/**
 * When a trip's email goes out: at 07:00 where the trip is.
 *
 * Every row is stamped 06:00 UTC on its day, and the cron used to send them all
 * at 07:00 UTC: "today's plan" reached Tokyo mid-afternoon and Honolulu at 20:00
 * the evening before. The cron now runs hourly, and a reminder or day email is
 * due once it is 07:00 on its day in the trip's own zone, taken from the first
 * stop of day one with coordinates. Where that zone isn't known, and for what
 * is sent after the trip (the traveller is home, in a zone we don't know), a row
 * keeps its stamp, as before.
 */

/** The hour, on the trip's own clock, its emails go out. */
export const LOCAL_SEND_HOUR = 7;

/**
 * How far past `now` the run reads stamps. The zone furthest east, UTC+14,
 * reaches 07:00 thirteen hours before a 06:00 UTC stamp.
 */
export const LOOKAHEAD_HOURS = 14;

/** The emails that follow the trip's clock: the reminders before it and the day emails during it. */
export function followsTripClock(slot: string): boolean {
  return isPreTripSlot(slot) || parseDigestDay(slot) !== null;
}

/** Minutes `timeZone` is ahead of UTC at the instant `t` (ms). */
function offsetMinutes(timeZone: string, t: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return Math.round((wall - t) / 60_000);
}

/**
 * The instant today began in `timeZone` (ISO). The one-email-a-day rule counts
 * the trip's own day once its emails follow its clock: a day counted in UTC would
 * hold back the first local-morning email east of Asia, sent the same UTC day as
 * one that went out at 07:00 UTC under the old schedule.
 */
export function localDayStart(timeZone: string, now: Date): string {
  const today = todayInTimeZone(timeZone, now);
  const midnightAsUtc = Date.parse(`${today}T00:00:00Z`);
  const first = midnightAsUtc - offsetMinutes(timeZone, midnightAsUtc) * 60_000;
  // Taken again at the first guess, the offset is right across a clock change
  // between the two instants (Sydney in April and October). If that lands on the
  // day before, the clocks skipped midnight itself (Santiago in September), and
  // the first guess is when the day began.
  const second = midnightAsUtc - offsetMinutes(timeZone, first) * 60_000;
  return new Date(todayInTimeZone(timeZone, new Date(second)) === today ? second : first).toISOString();
}

/** Whether it is `hour`:00 or later on `day` (YYYY-MM-DD), or a later day, in `timeZone`. */
export function localMorningReached(day: string, timeZone: string, now: Date, hour = LOCAL_SEND_HOUR): boolean {
  const today = todayInTimeZone(timeZone, now);
  if (today !== day) return today > day;
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return localHour >= hour;
}

/** The zone of a trip's day one (`itinerary->0`), from its first stop with coordinates; null when unknown. */
export function zoneOfDayOne(dayOne: unknown): string | null {
  if (!dayOne || typeof dayOne !== "object") return null;
  return deriveTimezoneFromItinerary([dayOne as ItineraryDay]);
}

/** Whether a row is due at `now`: on its trip's clock when it follows it and the zone is known, at its stamp otherwise. */
export function rowIsDue(row: { slot: string; scheduled_for: string }, timeZone: string | null, now: Date): boolean {
  if (timeZone && followsTripClock(row.slot)) {
    return localMorningReached(row.scheduled_for.slice(0, 10), timeZone, now);
  }
  return Date.parse(row.scheduled_for) <= now.getTime();
}
