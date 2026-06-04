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
 * DELETE /api/trips/[id] - Delete a trip
 */
export async function DELETE(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Delete trip (only if owned by user)
    const { error } = await supabase
      .from("trips")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("[Trips] Error deleting trip:", error);
      return errors.internal("Failed to delete trip", "Trips");
    }

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Trips] Error deleting trip:", error);
    return errors.internal("Failed to delete trip", "Trips");
  }
}
