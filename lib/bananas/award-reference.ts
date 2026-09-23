import { ACHIEVEMENTS } from "@/types/timeline";

/**
 * What /api/bananas/award may be credited for.
 *
 * WHY (2026-09-23)
 * The route checked that the trip belonged to the caller and that the
 * (user, type, reference_id) triple had not been credited before, but took
 * reference_id straight from the request. Any new string was a new credit:
 * a signed-in user with one trip could POST first_trip_bonus with
 * referenceId "a", "b", "c"... for 25 bananas each, or trip_complete for 10.
 * The reference now has to be the one the client actually sends for that
 * award (lib/hooks/useGamification.ts):
 *   activity_completion  an activity id that is in this trip's itinerary
 *   achievement_bonus    "<tripId>:<achievementId>" for a known achievement
 *   trip_complete        the trip id
 *   first_trip_bonus     the constant "first_trip" (once per user)
 */

export type AwardType =
  | "activity_completion"
  | "achievement_bonus"
  | "trip_complete"
  | "first_trip_bonus";

export const FIRST_TRIP_REFERENCE = "first_trip";

interface ItineraryLike {
  activities?: Array<{ id?: unknown } | null> | null;
}

/** Every activity id in an itinerary (the jsonb array stored on trips). */
export function itineraryActivityIds(itinerary: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(itinerary)) return ids;
  for (const day of itinerary as ItineraryLike[]) {
    if (!day || !Array.isArray(day.activities)) continue;
    for (const activity of day.activities) {
      if (activity && typeof activity.id === "string" && activity.id) ids.add(activity.id);
    }
  }
  return ids;
}

/** True when referenceId is the one this award type may be credited for. */
export function isValidAwardReference(
  type: AwardType,
  tripId: string,
  referenceId: string,
  itinerary: unknown
): boolean {
  switch (type) {
    case "activity_completion":
      return itineraryActivityIds(itinerary).has(referenceId);
    case "achievement_bonus": {
      const prefix = `${tripId}:`;
      if (!referenceId.startsWith(prefix)) return false;
      const achievementId = referenceId.slice(prefix.length);
      return Object.prototype.hasOwnProperty.call(ACHIEVEMENTS, achievementId);
    }
    case "trip_complete":
      return referenceId === tripId;
    case "first_trip_bonus":
      return referenceId === FIRST_TRIP_REFERENCE;
    default:
      return false;
  }
}
