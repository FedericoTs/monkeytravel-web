/**
 * Why a trip was discarded: the answers the planner's Start over and My Trips'
 * delete offer, stored in trip_deletion_feedback. The table's CHECK constraint
 * holds the same list, so a value added here needs a migration there.
 */
export const DELETION_REASONS = [
  "wrong_destination",
  "wrong_dates",
  "didnt_like_suggestions",
  "too_expensive",
  "made_by_mistake",
  "other",
] as const;

export type DeletionReason = (typeof DELETION_REASONS)[number];

/**
 * Sends why a saved trip is being deleted, with how old it is. Never in the
 * delete's way: a reason that can't be sent is dropped.
 */
export async function sendDeletionReason(
  tripId: string,
  reason: DeletionReason,
  trip?: { title?: string; created_at?: string },
): Promise<void> {
  const created = trip?.created_at ? Date.parse(trip.created_at) : NaN;
  try {
    await fetch(`/api/trips/${tripId}/deletion-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason,
        destination: trip?.title,
        trip_age_seconds: Number.isFinite(created) ? Math.max(0, Math.round((Date.now() - created) / 1000)) : undefined,
        was_auto_saved: false,
      }),
    });
  } catch {
    // The delete goes ahead without it.
  }
}
