import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { ItineraryDay } from "@/types";

/**
 * GET /api/trips/[id] - Fetch a single trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Fetch trip
    const { data: trip, error } = await supabase
      .from("trips")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !trip) {
      return errors.notFound("Trip not found");
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
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify trip ownership
    const { data: existingTrip, error: fetchError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTrip) {
      return errors.notFound("Trip not found");
    }

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

    // Handle other allowed fields
    const allowedFields = [
      "title",
      "description",
      "status",
      "tags",
      "budget",
      "cover_image_url",
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

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
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

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
