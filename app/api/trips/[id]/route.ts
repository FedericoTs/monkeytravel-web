import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { ItineraryDay } from "@/types";
import { scheduleTripNotifications } from "@/lib/notifications/scheduling";
import { refreshItineraryPhotos } from "@/lib/places/refreshItineraryPhotos";

/**
 * GET /api/trips/[id] - Fetch a single trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Fetch trip with ownership verification
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      "*"
    );
    if (tripError) return tripError;

    // Read-time refresh of activity photo URLs from places_v2. See
    // lib/places/refreshItineraryPhotos.ts for why this exists.
    // Falls back to the original itinerary silently on any DB error.
    const tripWithItin = trip as unknown as { itinerary?: unknown };
    if (tripWithItin && Array.isArray(tripWithItin.itinerary)) {
      const refreshed = await refreshItineraryPhotos(
        tripWithItin.itinerary as Array<{
          activities?: Array<{ image_url?: string | null }>;
        }>
      );
      tripWithItin.itinerary = refreshed;
    }

    return apiSuccess({ success: true, trip });
  } catch (error) {
    console.error("[Trips] Error fetching trip:", error);
    return errors.internal("Failed to fetch trip", "Trips");
  }
}

/**
 * PATCH /api/trips/[id] - Update trip (supports itinerary updates)
 */
export async function PATCH(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify trip ownership
    const { errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id
    );
    if (tripError) return tripError;

    // Parse request body
    const body = await request.json();

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Handle itinerary update - ensure all activities have IDs
    if (body.itinerary !== undefined) {
      const itinerary = body.itinerary as ItineraryDay[];

      // Validate itinerary structure
      if (!Array.isArray(itinerary)) {
        return errors.badRequest("Invalid itinerary format");
      }

      // Ensure all activities have IDs
      updates.itinerary = ensureActivityIds(itinerary);
    }

    // Handle other allowed fields. `start_date` and `end_date` are
    // accepted as ISO-date strings (YYYY-MM-DD); `reminders_muted`
    // is the per-trip pre-trip cascade mute toggle.
    const allowedFields = [
      "title",
      "description",
      "status",
      "tags",
      "budget",
      "cover_image_url",
      "start_date",
      "end_date",
      "reminders_muted",
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // CAUSALITY: capture whether this PATCH touches start_date / mute
    // BEFORE the update so we can re-enqueue the reminder cascade
    // after success. enqueue_trip_notifications(tripId, userId) is
    // idempotent (wipes pending → re-inserts), so this is safe to
    // call on every change without risking duplicates.
    const startDateChanged = body.start_date !== undefined;
    const muteChanged = body.reminders_muted !== undefined;

    // Update trip
    const { data: updatedTrip, error: updateError } = await supabase
      .from("trips")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) {
      console.error("[Trips] Error updating trip:", updateError);
      return errors.internal("Failed to update trip", "Trips");
    }

    // Re-enqueue (or wipe) the pre-trip cascade if the start_date or
    // mute toggle moved. Fire-and-forget — gated internally by the
    // calendar-export env flag and fail-closed against the user via
    // logging only (never re-throws). See
    // lib/notifications/scheduling.ts for details.
    if (startDateChanged || muteChanged) {
      void scheduleTripNotifications({ tripId: id, userId: user.id });
    }

    return apiSuccess({ success: true, trip: updatedTrip });
  } catch (error) {
    console.error("[Trips] Error updating trip:", error);
    return errors.internal("Failed to update trip", "Trips");
  }
}

/**
 * DELETE /api/trips/[id] - Soft-delete a trip
 *
 * Changed from hard DELETE to UPDATE deleted_at = NOW() on 2026-06-07.
 *
 * Why: the david-cassoni incident showed how lossy hard-delete is. He
 * signed up, generated a trip, chatted with the Concierge 7 times over
 * 17 minutes, then the trip disappeared (likely a misclick or UI
 * confusion). With hard-delete we lost the row, the conversation
 * context, the cover image work — everything. With soft-delete the
 * row stays put: RLS hides it from every read path, but we can
 * recover it on demand and we keep ai_conversations + activity
 * timeline foreign-keys valid.
 *
 * The DB-side change is in `supabase/migrations/...trips_soft_delete.sql`:
 *   - Column `deleted_at TIMESTAMPTZ`
 *   - Partial index on live rows
 *   - SELECT policy adds `deleted_at IS NULL AND (...)` so deleted trips
 *     vanish from /trips, /shared/[token], /explore, /it/explore, the
 *     trending feed, search results, and embedded queries.
 *   - UPDATE policy USING also checks `deleted_at IS NULL` so once a
 *     trip is tombstoned no further mutations land (collaborators
 *     can't edit a ghost).
 *
 * Hard delete remains *possible* (trips_delete_own RLS is intact) for
 * admin/cron cleanup, but it's no longer the user-facing default.
 *
 * Recovery: `UPDATE trips SET deleted_at = NULL WHERE id = '...'` from
 * the Supabase SQL editor. Self-serve restore UI is a follow-up.
 */
export async function DELETE(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Soft-delete: stamp deleted_at instead of removing the row. The
    // updated UPDATE-policy USING clause requires deleted_at IS NULL on
    // the OLD row, so a double-delete from a stale UI hits the WHERE
    // filter (0 rows match) and returns success — idempotent. The
    // explicit `.is("deleted_at", null)` guard makes that behavior
    // legible regardless of any future RLS reshuffle.
    const { error } = await supabase
      .from("trips")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null);

    if (error) {
      console.error("[Trips] Error soft-deleting trip:", error);
      return errors.internal("Failed to delete trip", "Trips");
    }

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Trips] Error soft-deleting trip:", error);
    return errors.internal("Failed to delete trip", "Trips");
  }
}
