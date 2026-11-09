import type { Activity, ItineraryDay } from "@/types";
import { calculateNextTimeSlot, determineTimeSlot, generateActivityId } from "@/lib/utils/activity-id";
import { isRealPoint } from "@/lib/trip/placeholder-point";

/**
 * The activity a planner adds to a day, from what they gave. It starts when
 * they said, else half an hour after the day's last activity ends (09:00 on
 * an empty day, 22:00 at the latest), and lasts 90 minutes unless said
 * otherwise. It is on the map only at a place of its own, one picked from the
 * search: one typed by hand has no pin, rather than a made-up one. Its cost
 * is the one given, else nothing yet in the trip's `currency`.
 */
export function newActivity(
  day: ItineraryDay,
  partialActivity: Partial<Activity>,
  { destination, currency }: { destination: string; currency: string }
): Activity {
  // The planner's time when they gave a clock time, else the next free slot.
  const given = partialActivity.start_time;
  const nextTime = given && /^([01]\d|2[0-3]):[0-5]\d$/.test(given) ? given : calculateNextTimeSlot(day);

  return {
    id: generateActivityId(),
    name: partialActivity.name || "New Activity",
    type: partialActivity.type || "activity",
    description: partialActivity.description || "",
    location: destination,
    address: partialActivity.address || "",
    coordinates: isRealPoint(partialActivity.coordinates) ? partialActivity.coordinates : undefined,
    start_time: nextTime,
    duration_minutes: partialActivity.duration_minutes || 90,
    time_slot: determineTimeSlot(nextTime),
    estimated_cost: partialActivity.estimated_cost || {
      amount: 0,
      currency,
      tier: "moderate",
    },
    tips: [],
    booking_required: false,
    image_url: partialActivity.image_url,
  };
}
