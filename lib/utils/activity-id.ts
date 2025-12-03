import { v4 as uuidv4 } from "uuid";
import type { Activity, ItineraryDay } from "@/types";

/**
 * Generate a unique activity ID using UUID v4
 */
export function generateActivityId(): string {
  return `act_${uuidv4().replace(/-/g, "").substring(0, 12)}`;
}

/**
 * Ensure all activities in an itinerary have unique IDs
 * Preserves existing IDs and only generates new ones where missing
 */
export function ensureActivityIds(itinerary: ItineraryDay[]): ItineraryDay[] {
  return itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => ({
      ...activity,
      id: activity.id || generateActivityId(),
    })),
  }));
}

/**
 * Find an activity by ID across all days
 * Returns the activity and its location (day index, activity index)
 */
export function findActivityById(
  itinerary: ItineraryDay[],
  activityId: string
): {
  activity: Activity;
  dayIndex: number;
  activityIndex: number;
} | null {
  for (let dayIndex = 0; dayIndex < itinerary.length; dayIndex++) {
    const day = itinerary[dayIndex];
    const activityIndex = day.activities.findIndex((a) => a.id === activityId);
    if (activityIndex !== -1) {
      return {
        activity: day.activities[activityIndex],
        dayIndex,
        activityIndex,
      };
    }
  }
  return null;
}

/**
 * Move an activity up or down within its day
 */
export function moveActivityInDay(
  itinerary: ItineraryDay[],
  activityId: string,
  direction: "up" | "down"
): ItineraryDay[] {
  const location = findActivityById(itinerary, activityId);
  if (!location) return itinerary;

  const { dayIndex, activityIndex } = location;
  const day = itinerary[dayIndex];
  const newIndex = direction === "up" ? activityIndex - 1 : activityIndex + 1;

  // Check bounds
  if (newIndex < 0 || newIndex >= day.activities.length) {
    return itinerary;
  }

  // Swap activities
  const newActivities = [...day.activities];
  [newActivities[activityIndex], newActivities[newIndex]] = [
    newActivities[newIndex],
    newActivities[activityIndex],
  ];

  return itinerary.map((d, i) =>
    i === dayIndex ? { ...d, activities: newActivities } : d
  );
}

/**
 * Move an activity to a different day
 */
export function moveActivityToDay(
  itinerary: ItineraryDay[],
  activityId: string,
  targetDayIndex: number
): ItineraryDay[] {
  const location = findActivityById(itinerary, activityId);
  if (!location) return itinerary;

  const { activity, dayIndex: sourceDayIndex, activityIndex } = location;

  // Same day, no change
  if (sourceDayIndex === targetDayIndex) return itinerary;

  // Check target day exists
  if (targetDayIndex < 0 || targetDayIndex >= itinerary.length) {
    return itinerary;
  }

  return itinerary.map((day, i) => {
    if (i === sourceDayIndex) {
      // Remove from source day
      return {
        ...day,
        activities: day.activities.filter((_, idx) => idx !== activityIndex),
      };
    }
    if (i === targetDayIndex) {
      // Add to target day
      return {
        ...day,
        activities: [...day.activities, activity],
      };
    }
    return day;
  });
}

/**
 * Delete an activity by ID
 */
export function deleteActivity(
  itinerary: ItineraryDay[],
  activityId: string
): ItineraryDay[] {
  return itinerary.map((day) => ({
    ...day,
    activities: day.activities.filter((a) => a.id !== activityId),
  }));
}

/**
 * Update an activity by ID
 */
export function updateActivity(
  itinerary: ItineraryDay[],
  activityId: string,
  updates: Partial<Activity>
): ItineraryDay[] {
  return itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((activity) =>
      activity.id === activityId ? { ...activity, ...updates } : activity
    ),
  }));
}

/**
 * Replace an activity with a new one (used for regeneration)
 */
export function replaceActivity(
  itinerary: ItineraryDay[],
  activityId: string,
  newActivity: Activity
): ItineraryDay[] {
  return itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((activity) =>
      activity.id === activityId ? { ...newActivity, id: activityId } : activity
    ),
  }));
}

/**
 * Get all activity names (used to avoid duplicates in regeneration)
 */
export function getAllActivityNames(itinerary: ItineraryDay[]): string[] {
  return itinerary.flatMap((day) => day.activities.map((a) => a.name));
}
