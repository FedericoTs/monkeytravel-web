import type { Activity, ItineraryDay } from "@/types";
import { calculateNextTimeSlot, determineTimeSlot, generateActivityId } from "@/lib/utils/activity-id";
import { getCoordinatesForNewActivity, type Coordinates } from "@/lib/utils/geo";
import { isRealPoint } from "@/lib/trip/placeholder-point";

/** The first real map point among the plan's activities, if any. */
export function firstRealPoint(itinerary: ItineraryDay[]): Coordinates | undefined {
  // Try to find coordinates from any existing activity in the itinerary
  for (const day of itinerary) {
    for (const activity of day.activities) {
      if (isRealPoint(activity.coordinates)) {
        return activity.coordinates;
      }
    }
  }
  return undefined;
}

/**
 * The activity a planner adds to a day, from what they gave. It starts when
 * they said, else half an hour after the day's last activity ends (09:00 on
 * an empty day, 22:00 at the latest), and lasts 90 minutes unless said
 * otherwise. Without
 * coordinates of its own it is placed near the day's other activities, else
 * near `nearPoint`. Its cost is the one given, else nothing yet in the trip's
 * `currency`.
 */
export function newActivity(
  day: ItineraryDay,
  partialActivity: Partial<Activity>,
  { destination, nearPoint, currency }: { destination: string; nearPoint: Coordinates | undefined; currency: string }
): Activity {
  // The planner's time when they gave a clock time, else the next free slot.
  const given = partialActivity.start_time;
  const nextTime = given && /^([01]\d|2[0-3]):[0-5]\d$/.test(given) ? given : calculateNextTimeSlot(day);

  // Generate coordinates if not provided
  // Priority: 1) Use provided coordinates, 2) Generate from existing activities
  let activityCoords = partialActivity.coordinates;
  if (!activityCoords?.lat || !activityCoords?.lng) {
    // Generate coordinates based on existing activities on this day or destination
    activityCoords = getCoordinatesForNewActivity(day.activities, nearPoint);
    if (activityCoords) {
      console.log(`[TripDetail] Generated coordinates for new activity: ${activityCoords.lat.toFixed(5)}, ${activityCoords.lng.toFixed(5)}`);
    }
  }

  return {
    id: generateActivityId(),
    name: partialActivity.name || "New Activity",
    type: partialActivity.type || "activity",
    description: partialActivity.description || "",
    location: destination,
    address: partialActivity.address || "",
    coordinates: activityCoords,
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
