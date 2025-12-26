import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripActivityRouteContext } from "@/lib/api/route-context";

/**
 * GET /api/trips/[id]/activities/[activityId] - Get timeline for a specific activity
 */
export async function GET(request: NextRequest, context: TripActivityRouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { data: timeline, error } = await supabase
      .from("activity_timelines")
      .select("*")
      .eq("trip_id", tripId)
      .eq("activity_id", activityId)
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      console.error("[Activity Timeline] Error fetching:", error);
      return errors.internal("Failed to fetch activity timeline", "Activity Timeline");
    }

    return apiSuccess({
      success: true,
      timeline: timeline || null,
    });
  } catch (error) {
    console.error("[Activity Timeline] Unexpected error in GET:", error);
    return errors.internal("Failed to fetch activity timeline", "Activity Timeline");
  }
}

/**
 * PATCH /api/trips/[id]/activities/[activityId] - Update activity timeline (status, rating, notes)
 */
export async function PATCH(request: NextRequest, context: TripActivityRouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify trip ownership
    const { errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id
    );
    if (tripError) return tripError;

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    // Handle status update
    if (body.status !== undefined) {
      const validStatuses = ["upcoming", "in_progress", "completed", "skipped"];
      if (!validStatuses.includes(body.status)) {
        return errors.badRequest("Invalid status");
      }
      updates.status = body.status;

      // Set timestamps based on status
      if (body.status === "in_progress") {
        updates.started_at = new Date().toISOString();
      } else if (body.status === "completed") {
        updates.completed_at = new Date().toISOString();
      }
    }

    // Handle rating
    if (body.rating !== undefined) {
      if (body.rating < 1 || body.rating > 5) {
        return errors.badRequest("Rating must be between 1 and 5");
      }
      updates.rating = body.rating;
    }

    // Handle notes
    if (body.notes !== undefined) {
      updates.experience_notes = body.notes;
    }

    // Handle quick tags
    if (body.quickTags !== undefined) {
      const validTags = [
        "must-do",
        "crowded",
        "worth-it",
        "skip-next-time",
        "hidden-gem",
        "overrated",
      ];
      const tags = Array.isArray(body.quickTags) ? body.quickTags : [];
      const filteredTags = tags.filter((t: string) => validTags.includes(t));
      updates.quick_tags = filteredTags;
    }

    // Handle skip reason
    if (body.skipReason !== undefined) {
      updates.skip_reason = body.skipReason;
    }

    // Handle actual duration
    if (body.actualDuration !== undefined) {
      updates.actual_duration_minutes = Number(body.actualDuration);
    }

    // Handle day number (for initial creation)
    if (body.dayNumber !== undefined) {
      updates.day_number = Number(body.dayNumber);
    }

    if (Object.keys(updates).length === 0) {
      return errors.badRequest("No valid fields to update");
    }

    // Upsert: create if not exists, update if exists
    const { data: timeline, error } = await supabase
      .from("activity_timelines")
      .upsert(
        {
          trip_id: tripId,
          activity_id: activityId,
          user_id: user.id,
          day_number: body.dayNumber || 1,
          ...updates,
        },
        {
          onConflict: "trip_id,activity_id,user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("[Activity Timeline] Error updating:", error);
      return errors.internal("Failed to update activity timeline", "Activity Timeline");
    }

    return apiSuccess({ success: true, timeline });
  } catch (error) {
    console.error("[Activity Timeline] Unexpected error in PATCH:", error);
    return errors.internal("Failed to update activity timeline", "Activity Timeline");
  }
}
