import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

/**
 * GET /api/trips/[id]/activities - Get all activity timelines for a trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify user has access to this trip (owner or collaborator)
    const { errorResponse: tripError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id
    );
    if (tripError) return tripError;

    // Fetch all activity timelines for this trip
    const { data: timelines, error } = await supabase
      .from("activity_timelines")
      .select("*")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .order("day_number", { ascending: true });

    if (error) {
      console.error("[Activities] Error fetching activity timelines:", error);
      return errors.internal("Failed to fetch activity timelines", "Activities");
    }

    return apiSuccess({ success: true, timelines: timelines || [] });
  } catch (error) {
    console.error("[Activities] Error fetching activity timelines:", error);
    return errors.internal("Failed to fetch activity timelines", "Activities");
  }
}
