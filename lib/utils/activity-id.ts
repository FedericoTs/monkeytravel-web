import { v4 as uuidv4 } from "uuid";
import type { Activity, ItineraryDay } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import {
  calculateHaversineDistance,
  estimateRoadDistance,
  getAverageSpeed,
} from "@/lib/math/distance";
import { formatMinutesToTime } from "@/lib/datetime/format";

/**
 * Calculate travel time between two activities in minutes
 * Uses local Haversine calculation - no API calls
 * @returns Travel time in minutes, or null if coordinates missing
 */
export function calculateTravelMinutes(
  fromActivity: Activity,
  toActivity: Activity
): number | null {
  const origin = fromActivity.coordinates;
  const destination = toActivity.coordinates;

  if (!origin || !destination) return null;

  const straightLineDistance = calculateHaversineDistance(origin, destination, "m");
  const mode = straightLineDistance < 1200 ? "WALKING" : "DRIVING";

  // Apply distance factor for actual road distance
  const travelDistance = mode === "WALKING"
    ? Math.round(straightLineDistance * 1.15)
    : estimateRoadDistance(straightLineDistance);

  // Calculate base travel time
  const avgSpeedKmh = getAverageSpeed(mode, travelDistance);
  const avgSpeedMs = (avgSpeedKmh * 1000) / 3600;
  const baseDurationSeconds = Math.round(travelDistance / avgSpeedMs);

  // Add buffer for crossings/traffic/transitions
  const bufferSeconds =
    mode === "WALKING"
      ? Math.round(travelDistance / 200) * 15
      : Math.round(travelDistance / 500) * 30;

  const totalDurationSeconds = baseDurationSeconds + bufferSeconds;

  // Convert to minutes, round up to nearest 5 minutes for scheduling
  const minutes = Math.ceil(totalDurationSeconds / 60 / 5) * 5;

  return minutes;
}

// ============================================================
// Activity Type-Aware Scheduling
// ============================================================

/**
 * Time preferences for different activity types (in minutes from midnight)
 */
interface TypeTimePreference {
  /** Preferred time ranges for this activity type */
  preferredRanges?: { start: number; end: number }[];
  /** Minimum start time (activity shouldn't start before this) */
  minStart?: number;
  /** Maximum start time (activity shouldn't start after this, or warn) */
  maxStart?: number;
}

const ACTIVITY_TYPE_TIMING: Record<string, TypeTimePreference> = {
  // Food & Dining - align with meal times
  restaurant: {
    preferredRanges: [
      { start: 7 * 60, end: 10 * 60 },        // Breakfast: 07:00-10:00
      { start: 12 * 60, end: 14.5 * 60 },     // Lunch: 12:00-14:30
      { start: 18.5 * 60, end: 21.5 * 60 },   // Dinner: 18:30-21:30
    ],
  },
  food: {
    preferredRanges: [
      { start: 7 * 60, end: 10 * 60 },
      { start: 12 * 60, end: 14.5 * 60 },
      { start: 18.5 * 60, end: 21.5 * 60 },
    ],
  },
  foodie: {
    preferredRanges: [
      { start: 12 * 60, end: 14.5 * 60 },
      { start: 18.5 * 60, end: 21.5 * 60 },
    ],
  },
  cafe: {
    preferredRanges: [
      { start: 7 * 60, end: 11 * 60 },        // Morning coffee
      { start: 14 * 60, end: 17 * 60 },       // Afternoon break
    ],
  },
  // Nightlife - evening only
  bar: {
    minStart: 17 * 60,                        // Not before 17:00
    preferredRanges: [
      { start: 18 * 60, end: 23 * 60 },
    ],
  },
  "wine bar": {
    minStart: 17 * 60,
    preferredRanges: [
      { start: 17 * 60, end: 22 * 60 },
    ],
  },
  nightlife: {
    minStart: 20 * 60,                        // Not before 20:00
    preferredRanges: [
      { start: 21 * 60, end: 24 * 60 },
    ],
  },
  entertainment: {
    preferredRanges: [
      { start: 10 * 60, end: 22 * 60 },       // Flexible, but daytime to evening
    ],
  },
  // Cultural - daytime activities
  museum: {
    minStart: 9 * 60,
    maxStart: 17 * 60,                        // Warn if starting after 17:00
    preferredRanges: [
      { start: 9 * 60, end: 17 * 60 },
    ],
  },
  cultural: {
    minStart: 9 * 60,
    maxStart: 18 * 60,
  },
  attraction: {
    minStart: 8 * 60,
    maxStart: 18 * 60,
  },
  landmark: {
    minStart: 8 * 60,
    maxStart: 19 * 60,
  },
  // Nature & Outdoors - morning preferred
  nature: {
    preferredRanges: [
      { start: 7 * 60, end: 12 * 60 },        // Morning (cooler, better light)
      { start: 15 * 60, end: 18 * 60 },       // Late afternoon
    ],
  },
  park: {
    preferredRanges: [
      { start: 7 * 60, end: 12 * 60 },
      { start: 15 * 60, end: 19 * 60 },
    ],
  },
  // Wellness - typically morning or afternoon
  spa: {
    preferredRanges: [
      { start: 9 * 60, end: 12 * 60 },
      { start: 14 * 60, end: 18 * 60 },
    ],
  },
  wellness: {
    preferredRanges: [
      { start: 8 * 60, end: 12 * 60 },
      { start: 14 * 60, end: 18 * 60 },
    ],
  },
  // Shopping - business hours
  shopping: {
    minStart: 9 * 60,
    maxStart: 20 * 60,
    preferredRanges: [
      { start: 10 * 60, end: 19 * 60 },
    ],
  },
  market: {
    preferredRanges: [
      { start: 7 * 60, end: 13 * 60 },        // Markets often best in morning
    ],
  },
};

/**
 * Check if a time falls within any of the preferred ranges
 */
function isInPreferredTimeRange(
  timeMinutes: number,
  preferences: TypeTimePreference
): boolean {
  if (!preferences.preferredRanges) return true;
  return preferences.preferredRanges.some(
    (range) => timeMinutes >= range.start && timeMinutes <= range.end
  );
}

/**
 * Find the nearest future preferred time slot for an activity type
 * @returns Adjusted time in minutes, or original if no adjustment needed
 */
function adjustToPreferredTime(
  calculatedTimeMinutes: number,
  activityType: string,
  maxWaitMinutes: number = 90  // Max time to wait for preferred slot
): number {
  const preferences = ACTIVITY_TYPE_TIMING[activityType];
  if (!preferences) return calculatedTimeMinutes;

  // Check minimum start time
  if (preferences.minStart && calculatedTimeMinutes < preferences.minStart) {
    return preferences.minStart;
  }

  // If no preferred ranges, just return calculated time
  if (!preferences.preferredRanges) return calculatedTimeMinutes;

  // Check if already in a preferred range
  if (isInPreferredTimeRange(calculatedTimeMinutes, preferences)) {
    return calculatedTimeMinutes;
  }

  // Find the next preferred range start
  for (const range of preferences.preferredRanges) {
    if (range.start > calculatedTimeMinutes) {
      const waitTime = range.start - calculatedTimeMinutes;
      // Only adjust if the wait is reasonable
      if (waitTime <= maxWaitMinutes) {
        return range.start;
      }
      break; // Don't check further ranges
    }
  }

  // No suitable preferred time found, use calculated time
  return calculatedTimeMinutes;
}

/**
 * Schedule warning types
 */
export interface ScheduleWarning {
  activityId: string;
  activityName: string;
  type: "late_schedule" | "type_mismatch" | "compressed";
  message: string;
}

/**
 * Result of schedule optimization
 */
export interface ScheduleResult {
  itinerary: ItineraryDay[];
  warnings: ScheduleWarning[];
}

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

/**
 * Add a new activity to a specific day
 */
export function addActivity(
  itinerary: ItineraryDay[],
  dayIndex: number,
  activity: Activity
): ItineraryDay[] {
  if (dayIndex < 0 || dayIndex >= itinerary.length) {
    return itinerary;
  }

  return itinerary.map((day, i) =>
    i === dayIndex
      ? { ...day, activities: [...day.activities, activity] }
      : day
  );
}

/**
 * Calculate the next available time slot based on existing activities
 */
export function calculateNextTimeSlot(day: ItineraryDay): string {
  if (!day.activities || day.activities.length === 0) {
    return "09:00";
  }

  // Find the last activity
  const lastActivity = day.activities[day.activities.length - 1];
  const startTime = lastActivity.start_time || "09:00";
  const duration = lastActivity.duration_minutes || 90;

  // Parse start time
  const [hours, minutes] = startTime.split(":").map(Number);
  const startMinutes = hours * 60 + minutes;

  // Calculate end time + 30 min buffer
  const endMinutes = startMinutes + duration + 30;

  // Cap at 22:00
  if (endMinutes >= 22 * 60) {
    return "22:00";
  }

  return formatMinutesToTime(endMinutes);
}

/**
 * Determine time slot (morning/afternoon/evening) from time string
 */
export function determineTimeSlot(time: string): "morning" | "afternoon" | "evening" {
  const [hours] = time.split(":").map(Number);
  if (hours < 12) return "morning";
  if (hours < 17) return "afternoon";
  return "evening";
}

/**
 * Reorder activities within a day by moving an item from oldIndex to newIndex
 * This is used for drag-and-drop reordering
 */
export function reorderActivities(
  itinerary: ItineraryDay[],
  dayIndex: number,
  oldIndex: number,
  newIndex: number
): ItineraryDay[] {
  if (dayIndex < 0 || dayIndex >= itinerary.length) {
    return itinerary;
  }

  const day = itinerary[dayIndex];
  const activities = [...day.activities];

  // Validate indices
  if (
    oldIndex < 0 ||
    oldIndex >= activities.length ||
    newIndex < 0 ||
    newIndex >= activities.length ||
    oldIndex === newIndex
  ) {
    return itinerary;
  }

  // Remove item from old position and insert at new position
  const [movedActivity] = activities.splice(oldIndex, 1);
  activities.splice(newIndex, 0, movedActivity);

  // Return new itinerary with reordered activities
  return itinerary.map((d, i) =>
    i === dayIndex ? { ...d, activities } : d
  );
}

/**
 * Recalculate activity times for a day with smart scheduling
 *
 * Features:
 * - Uses actual travel time (Haversine-based, no API calls)
 * - Respects booking_required activities as time anchors
 * - Adjusts times based on activity type (restaurants at meal times, etc.)
 * - Compresses schedule to fill gaps when activities are moved/removed
 * - Returns warnings for late schedules
 *
 * Algorithm:
 * 1. First activity keeps its original time
 * 2. Activities with booking_required keep their times (anchors)
 * 3. Other activities are scheduled based on previous activity end + travel time
 * 4. Activity types influence timing (e.g., restaurants near meal times)
 */
export function recalculateActivityTimes(
  itinerary: ItineraryDay[],
  dayIndex: number
): ItineraryDay[] {
  if (dayIndex < 0 || dayIndex >= itinerary.length) {
    return itinerary;
  }

  const day = itinerary[dayIndex];
  if (!day.activities || day.activities.length === 0) {
    return itinerary;
  }

  const DEFAULT_BUFFER_MINUTES = 30; // Fallback when coordinates missing
  const TRANSITION_BUFFER_MINUTES = 5; // Extra time for settling in
  const LATE_SCHEDULE_THRESHOLD = 22 * 60; // Warn if activity starts after 22:00

  // Build updated activities array incrementally so we can reference previous updates
  const updatedActivities: Activity[] = [];

  for (let index = 0; index < day.activities.length; index++) {
    const activity = day.activities[index];

    // First activity: apply type-aware scheduling from day start
    if (index === 0) {
      // Default start time for the day
      const defaultDayStart = 9 * 60; // 09:00

      // Apply type-aware timing for first activity
      // This ensures a dinner restaurant moved to first position
      // gets scheduled at breakfast time, not its original dinner time
      let firstActivityMinutes = adjustToPreferredTime(defaultDayStart, activity.type);

      // Format the time
      const time = formatMinutesToTime(firstActivityMinutes);

      updatedActivities.push({
        ...activity,
        start_time: time,
        time_slot: determineTimeSlot(time),
      });
      continue;
    }

    // Anchor activities: booking_required keeps their original time
    if (activity.booking_required && activity.start_time) {
      updatedActivities.push({
        ...activity,
        time_slot: determineTimeSlot(activity.start_time),
      });
      continue;
    }

    // Get the UPDATED previous activity (not the original)
    const prevActivity = updatedActivities[index - 1];
    const prevStart = prevActivity.start_time || "09:00";
    const prevDuration = prevActivity.duration_minutes || 90;

    // Parse previous start time
    const [prevHours, prevMinutes] = prevStart.split(":").map(Number);
    const prevStartMinutes = prevHours * 60 + prevMinutes;
    const prevEndMinutes = prevStartMinutes + prevDuration;

    // Calculate travel time using Haversine (or fallback)
    const travelMinutes = calculateTravelMinutes(prevActivity, activity);
    const gapMinutes = travelMinutes !== null
      ? travelMinutes + TRANSITION_BUFFER_MINUTES
      : DEFAULT_BUFFER_MINUTES;

    // Base calculated start time
    let nextMinutes = prevEndMinutes + gapMinutes;

    // Apply activity type timing preferences
    nextMinutes = adjustToPreferredTime(nextMinutes, activity.type);

    // Cap at 23:00 to avoid going past midnight
    if (nextMinutes >= 23 * 60) {
      nextMinutes = 23 * 60;
    }

    // Format the new time
    const newTime = formatMinutesToTime(nextMinutes);

    updatedActivities.push({
      ...activity,
      start_time: newTime,
      time_slot: determineTimeSlot(newTime),
    });
  }

  return itinerary.map((d, i) =>
    i === dayIndex ? { ...d, activities: updatedActivities } : d
  );
}

/**
 * Recalculate activity times with warnings
 * Use this version when you need to display warnings to the user
 */
export function recalculateActivityTimesWithWarnings(
  itinerary: ItineraryDay[],
  dayIndex: number
): ScheduleResult {
  if (dayIndex < 0 || dayIndex >= itinerary.length) {
    return { itinerary, warnings: [] };
  }

  const day = itinerary[dayIndex];
  if (!day.activities || day.activities.length === 0) {
    return { itinerary, warnings: [] };
  }

  const warnings: ScheduleWarning[] = [];
  const DEFAULT_BUFFER_MINUTES = 30;
  const TRANSITION_BUFFER_MINUTES = 5;
  const LATE_SCHEDULE_THRESHOLD = 22 * 60;

  const updatedActivities: Activity[] = [];

  for (let index = 0; index < day.activities.length; index++) {
    const activity = day.activities[index];

    // First activity: apply type-aware scheduling from day start
    if (index === 0) {
      const defaultDayStart = 9 * 60; // 09:00
      const firstActivityMinutes = adjustToPreferredTime(defaultDayStart, activity.type);
      const time = formatMinutesToTime(firstActivityMinutes);

      updatedActivities.push({
        ...activity,
        start_time: time,
        time_slot: determineTimeSlot(time),
      });
      continue;
    }

    if (activity.booking_required && activity.start_time) {
      updatedActivities.push({
        ...activity,
        time_slot: determineTimeSlot(activity.start_time),
      });
      continue;
    }

    const prevActivity = updatedActivities[index - 1];
    const prevStart = prevActivity.start_time || "09:00";
    const prevDuration = prevActivity.duration_minutes || 90;

    const [prevHours, prevMinutes] = prevStart.split(":").map(Number);
    const prevStartMinutes = prevHours * 60 + prevMinutes;
    const prevEndMinutes = prevStartMinutes + prevDuration;

    const travelMinutes = calculateTravelMinutes(prevActivity, activity);
    const gapMinutes = travelMinutes !== null
      ? travelMinutes + TRANSITION_BUFFER_MINUTES
      : DEFAULT_BUFFER_MINUTES;

    let nextMinutes = prevEndMinutes + gapMinutes;

    // Apply type timing and track if adjusted
    nextMinutes = adjustToPreferredTime(nextMinutes, activity.type);

    // Check for type mismatch (scheduled outside preferred time)
    const preferences = ACTIVITY_TYPE_TIMING[activity.type];
    if (preferences?.maxStart && nextMinutes > preferences.maxStart) {
      warnings.push({
        activityId: activity.id || `activity-${index}`,
        activityName: activity.name,
        type: "type_mismatch",
        message: `${activity.name} is scheduled late for a ${activity.type} activity`,
      });
    }

    // Cap at 23:00
    if (nextMinutes >= 23 * 60) {
      nextMinutes = 23 * 60;
    }

    // Check for late schedule
    if (nextMinutes >= LATE_SCHEDULE_THRESHOLD) {
      warnings.push({
        activityId: activity.id || `activity-${index}`,
        activityName: activity.name,
        type: "late_schedule",
        message: `${activity.name} is scheduled after 22:00`,
      });
    }

    const newTime = formatMinutesToTime(nextMinutes);

    updatedActivities.push({
      ...activity,
      start_time: newTime,
      time_slot: determineTimeSlot(newTime),
    });
  }

  const updatedItinerary = itinerary.map((d, i) =>
    i === dayIndex ? { ...d, activities: updatedActivities } : d
  );

  return { itinerary: updatedItinerary, warnings };
}
