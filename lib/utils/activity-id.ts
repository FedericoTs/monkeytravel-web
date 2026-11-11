import { v4 as uuidv4 } from "uuid";
import type { Activity, ItineraryDay } from "@/types";
import {
  calculateHaversineDistance,
  estimateRoadDistance,
  getAverageSpeed,
} from "@/lib/math/distance";
import { formatMinutesToTime } from "@/lib/datetime/format";
import { isRealPoint } from "@/lib/trip/placeholder-point";

/**
 * Calculate travel time between two activities in minutes
 * Uses local Haversine calculation - no API calls
 * @returns Travel time in minutes, or null when either place has no known
 * location: no coordinates, 0,0, or the coordinate fallback's placeholder point
 */
export function calculateTravelMinutes(
  fromActivity: Activity,
  toActivity: Activity
): number | null {
  const origin = fromActivity.coordinates;
  const destination = toActivity.coordinates;

  if (!isRealPoint(origin) || !isRealPoint(destination)) return null;

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
// Days and activities that are not plain objects pass through untouched:
// these helpers run on trip inserts, where a throw would lose the save.
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function ensureActivityIds(itinerary: ItineraryDay[]): ItineraryDay[] {
  return itinerary.map((day) =>
    isPlainObject(day) && Array.isArray(day.activities)
      ? {
          ...day,
          activities: day.activities.map((activity) =>
            isPlainObject(activity) ? { ...activity, id: activity.id || generateActivityId() } : activity
          ),
        }
      : day
  );
}

// FNV-1a, 32 bit.
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Same shape as generateActivityId, derived from the activity's place in the trip. */
export function stableActivityId(tripId: string, dayIndex: number, activityIndex: number, name: string | undefined): string {
  const key = `${tripId}|${dayIndex}|${activityIndex}|${name ?? ""}`;
  const hex = fnv1a(key, 0x811c9dc5).toString(16).padStart(8, "0") + fnv1a(key, 0x9747b28c).toString(16).padStart(8, "0");
  return `act_${hex.substring(0, 12)}`;
}

/**
 * ensureActivityIds for a STORED trip: an activity stored without an id gets
 * one derived from the trip, its position and its name, so every render of
 * the same stored copy mints the same ids (the trip page can mount several
 * times per load, be restored from the router cache, refetch). Random ids
 * made two renders of one stored copy look like different content: a phantom
 * edit, then a false "changed somewhere else" conflict.
 */
export function ensureActivityIdsStable(itinerary: ItineraryDay[], tripId: string): ItineraryDay[] {
  return itinerary.map((day, dayIndex) =>
    isPlainObject(day) && Array.isArray(day.activities)
      ? {
          ...day,
          activities: day.activities.map((activity, activityIndex) =>
            isPlainObject(activity)
              ? { ...activity, id: activity.id || stableActivityId(tripId, dayIndex, activityIndex, activity.name) }
              : activity
          ),
        }
      : day
  );
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

function timeToMinutes(time: string | undefined): number | null {
  const m = typeof time === "string" ? time.match(/^(\d{1,2}):(\d{2})/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The slot in `day` where an activity starting at `startTime` keeps its
 * place in the day's chronological order: before the first activity that
 * starts later, else at the end. A morning museum moved to another day stays
 * a morning museum instead of being tacked onto the evening. A stop the
 * traveller set to a time goes before one that starts then (`sameTime:
 * "before"`), which then makes room for it.
 */
export function chronologicalInsertIndex(
  day: ItineraryDay,
  startTime: string | undefined,
  sameTime: "after" | "before" = "after"
): number {
  const minutes = timeToMinutes(startTime);
  if (minutes === null) return day.activities.length;
  const idx = day.activities.findIndex((a) => {
    const other = timeToMinutes(a.start_time);
    return other !== null && (other > minutes || (sameTime === "before" && other === minutes));
  });
  return idx === -1 ? day.activities.length : idx;
}

/**
 * Move an activity to a different day.
 *
 * `targetIndex` decides where it lands in the target day:
 *   - omitted → appended (legacy behaviour, used by the assistant route)
 *   - a number → inserted at that index (clamped), e.g. a drag drop position
 *   - "auto"   → its chronological slot by start time (the "Move to day"
 *                sheet), so it keeps the same part of the day
 */
export function moveActivityToDay(
  itinerary: ItineraryDay[],
  activityId: string,
  targetDayIndex: number,
  targetIndex?: number | "auto"
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

  const targetDay = itinerary[targetDayIndex];
  const insertAt =
    targetIndex === undefined
      ? targetDay.activities.length
      : targetIndex === "auto"
        ? chronologicalInsertIndex(targetDay, activity.start_time)
        : Math.max(0, Math.min(targetIndex, targetDay.activities.length));

  return itinerary.map((day, i) => {
    if (i === sourceDayIndex) {
      // Remove from source day
      return {
        ...day,
        activities: day.activities.filter((_, idx) => idx !== activityIndex),
      };
    }
    if (i === targetDayIndex) {
      // Insert into target day
      const activities = [...day.activities];
      activities.splice(insertAt, 0, activity);
      return { ...day, activities };
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
 * A stop's edit by the traveller. A new start time puts it in its time order
 * at that time, before a stop that starts then; with a new time or length, a
 * later stop moves only when this one now runs into it (fitMovedStop,
 * "exact"). The times before it stay.
 */
export function editActivity(
  itinerary: ItineraryDay[],
  activityId: string,
  updates: Partial<Activity>
): ItineraryDay[] {
  const found = findActivityById(itinerary, activityId);
  if (!found) return itinerary;
  const { activity, dayIndex, activityIndex } = found;
  const edited = { ...activity, ...updates };
  const newTime = edited.start_time !== activity.start_time;
  if (!newTime && edited.duration_minutes === activity.duration_minutes) {
    return updateActivity(itinerary, activityId, updates);
  }

  const day = itinerary[dayIndex];
  const others = day.activities.filter((a) => a.id !== activityId);
  const at = newTime ? chronologicalInsertIndex({ ...day, activities: others }, edited.start_time, "before") : activityIndex;
  const stop = newTime && edited.start_time ? { ...edited, time_slot: determineTimeSlot(edited.start_time) } : edited;
  const activities = [...others.slice(0, at), stop, ...others.slice(at)];
  return fitMovedStop(itinerary.map((d, i) => (i === dayIndex ? { ...d, activities } : d)), dayIndex, activityId, "exact");
}

/**
 * How long `activity` is still on once `next` has started, in minutes: 0 when
 * the next one starts after it ends, or when a time or its length is unknown.
 */
export function overlapMinutes(activity: Activity, next: Activity): number {
  const start = minutesOf(activity.start_time);
  const nextStart = minutesOf(next.start_time);
  if (start === null || nextStart === null || !(activity.duration_minutes > 0)) return 0;
  return Math.max(0, start + activity.duration_minutes - nextStart);
}

/** How many stops, other than `exceptId`, start at another time in `after` than in `before`. */
export function retimedCount(before: ItineraryDay[], after: ItineraryDay[], exceptId: string): number {
  const was = new Map(before.flatMap((d) => d.activities.map((a) => [a.id, a.start_time] as const)));
  return after
    .flatMap((d) => d.activities)
    .filter((a) => a.id !== exceptId && was.has(a.id) && was.get(a.id) !== a.start_time).length;
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
 * Add a new activity to a day, in its time order.
 */
export function addActivity(
  itinerary: ItineraryDay[],
  dayIndex: number,
  activity: Activity
): ItineraryDay[] {
  if (dayIndex < 0 || dayIndex >= itinerary.length) {
    return itinerary;
  }

  // At the time asked for, in its time order; a later stop moves only when the
  // new one runs into it (fitMovedStop).
  const day = itinerary[dayIndex];
  const at = chronologicalInsertIndex(day, activity.start_time, "before");
  const activities = [...day.activities.slice(0, at), activity, ...day.activities.slice(at)];
  const added = itinerary.map((d, i) => (i === dayIndex ? { ...d, activities } : d));
  return activity.id ? fitMovedStop(added, dayIndex, activity.id, "exact") : added;
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

/** A journey of unknown length: one place, or both, has no known location. */
const UNKNOWN_JOURNEY_MINUTES = 30;
/** Getting from the door to the next stop, on top of a measured journey. */
const SETTLE_MINUTES = 5;
/** A stop's length when it gives none. */
const DEFAULT_DURATION_MINUTES = 90;
/** The latest start a time can show. */
const LAST_MINUTE = 23 * 60 + 59;

/** Minutes after midnight for "HH:MM", or null. */
function minutesOf(time: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A stop the traveller fixed: booked, or a fixed plan. Its time never moves. */
export function isFixed(activity: Activity): boolean {
  return activity.booking_required === true || (activity as { locked?: boolean }).locked === true;
}

/** The earliest `next` can start: when `prev` ends, plus the journey between them. */
function earliestAfter(prev: Activity, next: Activity): number | null {
  const start = minutesOf(prev.start_time);
  if (start === null) return null;
  const travel = calculateTravelMinutes(prev, next);
  const journey = travel === null ? UNKNOWN_JOURNEY_MINUTES : travel + SETTLE_MINUTES;
  return start + (prev.duration_minutes || DEFAULT_DURATION_MINUTES) + journey;
}

/**
 * The day's times after a stop was moved into it or within it, or set by the
 * traveller. Only the moved stop gets a new time: its own ("keep", for a stop
 * that arrived from another day in its time order) or the slot after the stop
 * before it ("slot", for a stop put at a place in the list; at the top, the
 * day's start), starting no earlier than the one before it ends, journey
 * included. A time the traveller set ("exact") stays as it is. Each later stop
 * moves only when it would start before the one before it ends. Nothing is
 * pulled earlier, a booked stop or a fixed plan keeps its time, and the other
 * days are left as they are.
 */
export function fitMovedStop(
  itinerary: ItineraryDay[],
  dayIndex: number,
  movedId: string,
  mode: "keep" | "slot" | "exact"
): ItineraryDay[] {
  const day = itinerary[dayIndex];
  const at = day ? day.activities.findIndex((a) => a.id === movedId) : -1;
  if (!day || at === -1) return itinerary;

  const activities = [...day.activities];
  const retime = (i: number, minutes: number) => {
    const time = formatMinutesToTime(Math.min(minutes, LAST_MINUTE));
    activities[i] = { ...activities[i], start_time: time, time_slot: determineTimeSlot(time) };
  };

  const moved = activities[at];
  if (!isFixed(moved) && mode !== "exact") {
    const own = minutesOf(moved.start_time);
    const wanted = mode === "keep" ? own : at === 0 ? (minutesOf(activities[1]?.start_time) ?? own) : null;
    const after = at > 0 ? earliestAfter(activities[at - 1], moved) : null;
    const start = Math.max(wanted ?? after ?? own ?? 9 * 60, after ?? 0);
    if (start !== own) retime(at, start);
  }

  for (let i = at + 1; i < activities.length; i++) {
    if (isFixed(activities[i])) continue;
    const earliest = earliestAfter(activities[i - 1], activities[i]);
    const own = minutesOf(activities[i].start_time);
    if (earliest !== null && (own === null || own < earliest)) retime(i, earliest);
  }

  return itinerary.map((d, i) => (i === dayIndex ? { ...d, activities } : d));
}
