import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { CachedDayTravelData, TripMeta } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

interface TravelCacheBody {
  travel_distances: CachedDayTravelData[];
  travel_distances_hash: string;
}

/**
 * POST /api/trips/[id]/travel-cache
 * Saves calculated travel distances to trip_meta for persistence
 * These are calculated locally using Haversine formula - no external API costs
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify ownership and get trip_meta
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      "id, user_id, trip_meta"
    );
    if (tripError) return tripError;

    // Parse request body
    const body: TravelCacheBody = await request.json();

    if (!body.travel_distances || !body.travel_distances_hash) {
      return errors.badRequest("Missing travel_distances or travel_distances_hash");
    }

    // Merge with existing trip_meta
    const existingMeta = (trip.trip_meta as TripMeta) || {};
    const updatedMeta: TripMeta = {
      ...existingMeta,
      travel_distances: body.travel_distances,
      travel_distances_hash: body.travel_distances_hash,
    };

    // Update trip_meta
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        trip_meta: updatedMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[Travel Cache] Error updating travel cache:", updateError);
      return errors.internal("Failed to save travel cache", "Travel Cache");
    }

    return apiSuccess({
      success: true,
      message: "Travel distances cached successfully",
    });
  } catch (error) {
    console.error("[Travel Cache] Error in travel-cache API:", error);
    return errors.internal("Failed to save travel cache", "Travel Cache");
  }
}
