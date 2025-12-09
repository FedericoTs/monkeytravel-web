import { v4 as uuidv4 } from "uuid";
import type { Activity, ItineraryDay } from "@/types";

// ============================================================
// Travel Time Calculation (Haversine-based, no API calls)
// ============================================================

interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Calculate straight-line distance using Haversine formula
 * @returns Distance in meters
 */
function calculateHaversineDistance(
  origin: Coordinates,
  destination: Coordinates
): number {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = (origin.lat * Math.PI) / 180;
  const lat2Rad = (destination.lat * Math.PI) / 180;
  const deltaLat = ((destination.lat - origin.lat) * Math.PI) / 180;
  const deltaLng = ((destination.lng - origin.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Estimate actual road distance from straight-line distance
 * Applies distance-based factors for urban navigation
 */
function estimateRoadDistance(straightLineMeters: number): number {
  let factor: number;
  if (straightLineMeters < 500) factor = 1.2;
  else if (straightLineMeters < 2000) factor = 1.3;
  else if (straightLineMeters < 5000) factor = 1.35;
  else factor = 1.4;
  return Math.round(straightLineMeters * factor);
}

/**
 * Get average travel speed based on mode and distance
 * @returns Speed in km/h
 */
function getAverageSpeed(mode: "WALKING" | "DRIVING", distanceMeters: number): number {
  if (mode === "WALKING") return 4.8; // km/h - comfortable walking pace
  // Driving speeds vary by distance (urban traffic)
  if (distanceMeters < 2000) return 18;
  if (distanceMeters < 5000) return 22;
  if (distanceMeters < 10000) return 28;
  return 35;
}

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

  const straightLineDistance = calculateHaversineDistance(origin, destination);
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

  // Convert back to HH:MM
  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;

  // Cap at 22:00
  if (endHours >= 22) {
    return "22:00";
  }

  return `${endHours.toString().padStart(2, "0")}:${endMins.toString().padStart(2, "0")}`;
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
 * Recalculate activity times for a day based on their order and travel distances
 * Uses smart scheduling: actual travel time (Haversine) + small buffer
 * Falls back to 30-min buffer if coordinates are missing
 *
 * First activity keeps its time (or defaults to 09:00)
 * Subsequent activities are scheduled based on:
 *   prevEnd + travelTime + transitionBuffer (5 min)
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

  const updatedActivities = day.activities.map((activity, index) => {
    if (index === 0) {
      // Keep first activity's time or default to 09:00
      const time = activity.start_time || "09:00";
      return {
        ...activity,
        start_time: time,
        time_slot: determineTimeSlot(time),
      };
    }

    // Calculate start time based on previous activity
    const prevActivity = day.activities[index - 1];
    const prevStart = prevActivity.start_time || "09:00";
    const prevDuration = prevActivity.duration_minutes || 90;

    // Parse previous start time
    const [hours, minutes] = prevStart.split(":").map(Number);
    const startMinutes = hours * 60 + minutes;

    // Calculate travel time using Haversine (or fallback)
    const travelMinutes = calculateTravelMinutes(prevActivity, activity);
    const gapMinutes = travelMinutes !== null
      ? travelMinutes + TRANSITION_BUFFER_MINUTES
      : DEFAULT_BUFFER_MINUTES;

    // Calculate next activity start time
    let nextMinutes = startMinutes + prevDuration + gapMinutes;

    // Cap at 23:00 to avoid going past midnight
    if (nextMinutes >= 23 * 60) {
      nextMinutes = 23 * 60;
    }

    const nextHours = Math.floor(nextMinutes / 60);
    const nextMins = nextMinutes % 60;
    const newTime = `${nextHours.toString().padStart(2, "0")}:${nextMins.toString().padStart(2, "0")}`;

    return {
      ...activity,
      start_time: newTime,
      time_slot: determineTimeSlot(newTime),
    };
  });

  return itinerary.map((d, i) =>
    i === dayIndex ? { ...d, activities: updatedActivities } : d
  );
}
