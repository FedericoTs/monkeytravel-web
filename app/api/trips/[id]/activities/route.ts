import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

/**
 * GET /api/trips/[id]/activities - Get all activity timelines for a trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

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
