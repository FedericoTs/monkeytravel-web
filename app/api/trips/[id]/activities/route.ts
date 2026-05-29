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

    // Fetch all activity timelines for this trip.
    // Timelines are SHARED per trip (one source-of-truth, owner-scoped writes)
    // so collaborators read the same rows as the owner. Access control is
    // handled by verifyTripAccess above plus the RLS policy on
    // activity_timelines (see 20260529_activity_timelines_shared_rls.sql).
    const { data: timelines, error } = await supabase
      .from("activity_timelines")
      .select("*")
      .eq("trip_id", tripId)
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
