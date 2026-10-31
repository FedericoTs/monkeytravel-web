/**
 * What a plan needs that the server can work out itself, so the model is not
 * asked to write it: booking links, each activity's part of the day, and
 * booking_required when the model left it out.
 */
import { determineTimeSlot } from "@/lib/utils/activity-id";
import { bookingLinksFor } from "./booking-links";
import type { Activity, GeneratedItinerary, TripCreationParams } from "@/types";

export { bookingLinksFor };

type TripDates = Pick<TripCreationParams, "destination" | "startDate" | "endDate">;

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
  for (const day of itinerary.days ?? []) withActivityDefaults(day);
  itinerary.booking_links ??= bookingLinksFor(params);
  return itinerary;
}
