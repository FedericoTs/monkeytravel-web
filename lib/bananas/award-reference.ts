import { ACHIEVEMENTS } from "@/types/timeline";

/**
 * What /api/bananas/award may be credited for, and under which reference.
 *
 * WHY (2026-09-23)
 * The route checked that the trip belonged to the caller and that the
 * (user, type, reference_id) triple had not been credited before, but took
 * reference_id straight from the request. Any new string was a new credit:
 * a signed-in user with one trip could POST first_trip_bonus with
 * referenceId "a", "b", "c"... for 25 bananas each, or trip_complete for 10.
 * Bananas buy extra AI generations and a premium trial.
 *
 * What each award now accepts (the client contract is
 * lib/hooks/useGamification.ts):
 *   achievement_bonus    "<tripId>:<achievementId>" for a known achievement
 *   trip_complete        the trip id
 *   first_trip_bonus     the constant "first_trip" (once per user)
 *   activity_completion  any activity reference, stored as
 *                        "<tripId>:<activityId>", and the route caps a trip
 *                        at one credit per activity in its itinerary.
 * Activity completion is capped rather than matched against stored ids
 * because many itineraries are saved without activity ids and the browser
 * mints fresh random ones on every load (ensureActivityIds), so a real
 * completion's id is often not in the stored itinerary.
 *
 * The route also caps gameplay awards per user per day
 * (DAILY_GAMEPLAY_AWARD_CAP), which bounds farming across many trips.
 */

export type AwardType =
  | "activity_completion"
  | "achievement_bonus"
  | "trip_complete"
  | "first_trip_bonus";

export const FIRST_TRIP_REFERENCE = "first_trip";

/**
 * Most one person can earn from gameplay in 24 hours. A 30-activity trip
 * finished in a day with every achievement is about 115, first-trip bonus
 * included; real days are far below it.
 */
export const DAILY_GAMEPLAY_AWARD_CAP = 150;

const MAX_ACTIVITY_REFERENCE_LENGTH = 128;

interface ItineraryLike {
  activities?: unknown;
}

/** How many activities the stored itinerary holds, with or without ids. */
export function itineraryActivityCount(itinerary: unknown): number {
  if (!Array.isArray(itinerary)) return 0;
  let n = 0;
  for (const day of itinerary as ItineraryLike[]) {
    if (day && Array.isArray(day.activities)) {
      n += day.activities.filter((a) => a && typeof a === "object").length;
    }
  }
  return n;
}

/** The reference_id stored for an activity completion on this trip. */
export function activityReferenceFor(tripId: string, activityId: string): string {
  return `${tripId}:${activityId}`;
}

/**
 * The reference this award is stored under, or null when the request's
 * reference is not one this award accepts.
 */
export function storedAwardReference(
  type: AwardType,
  tripId: string,
  referenceId: string
): string | null {
  switch (type) {
    case "activity_completion":
      if (!referenceId || referenceId.length > MAX_ACTIVITY_REFERENCE_LENGTH) return null;
      return activityReferenceFor(tripId, referenceId);
    case "achievement_bonus": {
      const prefix = `${tripId}:`;
      if (!referenceId.startsWith(prefix)) return null;
      const achievementId = referenceId.slice(prefix.length);
      return Object.prototype.hasOwnProperty.call(ACHIEVEMENTS, achievementId) ? referenceId : null;
    }
    case "trip_complete":
      return referenceId === tripId ? tripId : null;
    case "first_trip_bonus":
      return referenceId === FIRST_TRIP_REFERENCE ? FIRST_TRIP_REFERENCE : null;
    default:
      return null;
  }
}
