import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
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

    // Verify trip ownership
    const { errorResponse: tripError } = await verifyTripOwnership(
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
