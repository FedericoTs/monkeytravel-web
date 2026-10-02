import "server-only";
import { dangerouslyDeleteByTag } from "@vercel/functions";

/** The CDN tag on every rendered card of a trip (app/api/og/trip). */
export const tripCardTag = (tripId: string) => `trip-card-${tripId}`;

/**
 * Drop a trip's cached cards once its link stops resolving (deleted,
 * unshared, unpublished). The CDN otherwise keeps serving them for a day.
 */
export function purgeTripCard(tripId: string): Promise<void> {
  return dangerouslyDeleteByTag(tripCardTag(tripId)).catch((err: unknown) => {
    console.error("[trip-card] cache purge failed", err);
  });
}
