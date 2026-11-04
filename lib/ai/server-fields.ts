/**
 * What a plan needs that the server can work out itself, so the model's word is
 * not taken for it: the days' numbers and dates, booking links, each activity's
 * part of the day, and booking_required when the model left it out.
 */
import { addIsoDays, tripSpanDays } from "@/lib/dates/iso-date";
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { bookingLinksFor } from "./booking-links";
import type { Activity, GeneratedItinerary, TripCreationParams } from "@/types";

export { bookingLinksFor };

type TripDates = Pick<TripCreationParams, "destination" | "startDate" | "endDate">;

/**
 * Days numbered and dated by their place in the trip, whatever the model wrote:
 * it can count a month wrong ("Nov 31") and repeat a day to reach the end date.
 * `range` says which of the trip's days these are; any beyond it go.
 */
export function placeDays<T extends object>(days: T[], range: { from: number; to: number }, startDate: string): T[] {
  return days.slice(0, range.to - range.from + 1).map(
    (day, i) =>
      ({
        ...day,
        day_number: range.from + i,
        date: addIsoDays(startDate, range.from - 1 + i) ?? (day as { date?: string }).date,
      }) as T
  );
}

/** A day's activities with their part of the day, from the start time, and booking_required false unless the model said true. */
export function withActivityDefaults<T extends { activities?: Partial<Activity>[] }>(day: T): T {
  for (const activity of day.activities ?? []) {
    if (typeof activity.start_time === "string" && /^\d{1,2}:\d{2}/.test(activity.start_time)) {
      activity.time_slot = determineTimeSlot(activity.start_time);
    }
    activity.booking_required ??= false;
  }
  return day;
}

/** A plan with what the model no longer writes filled in. */
export function withServerFields(itinerary: GeneratedItinerary, params: TripDates): GeneratedItinerary {
  const span = tripSpanDays(params.startDate, params.endDate);
  if (span > 0 && itinerary.days) itinerary.days = placeDays(itinerary.days, { from: 1, to: span }, params.startDate);
  for (const day of itinerary.days ?? []) withActivityDefaults(day);
  itinerary.booking_links ??= bookingLinksFor(params);
  return itinerary;
}
