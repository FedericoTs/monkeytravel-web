import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * POST /api/trips/[id]/submit-trending
 * Submits a trip to the trending gallery
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return errors.unauthorized();
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id, visibility, share_token, submitted_to_trending_at")
      .eq("id", id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    if (trip.user_id !== user.id) {
      return errors.forbidden("Not authorized to modify this trip");
    }

    // Trip must be shared first
    if (!trip.share_token) {
      return errors.badRequest("Trip must be shared before submitting to trending");
    }

    // Already submitted
    if (trip.submitted_to_trending_at) {
      return apiSuccess({
        success: true,
        message: "Trip is already in trending",
        already_submitted: true,
      });
    }

    // Submit to trending
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        visibility: "public",
        submitted_to_trending_at: new Date().toISOString(),
        trending_approved: true, // Auto-approve for now, can add moderation later
      })
      .eq("id", id);

    if (updateError) {
      console.error("[Submit Trending] Update error:", updateError);
      return errors.internal("Failed to submit to trending", "Submit Trending");
    }

    // Update trending score
    await supabase.rpc("update_trip_trending_score", { p_trip_id: id });

    return apiSuccess({
      success: true,
      message: "Trip submitted to trending!",
    });
  } catch (error) {
    console.error("[Submit Trending] Unexpected error:", error);
    return errors.internal("Internal server error", "Submit Trending");
  }
}

/**
 * DELETE /api/trips/[id]/submit-trending
 * Removes a trip from the trending gallery
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return errors.unauthorized();
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    if (trip.user_id !== user.id) {
      return errors.forbidden("Not authorized to modify this trip");
    }

    // Remove from trending
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        visibility: "shared", // Keep shared but not public
        submitted_to_trending_at: null,
        trending_approved: false,
        trending_score: 0,
      })
      .eq("id", id);

    if (updateError) {
      console.error("[Remove Trending] Update error:", updateError);
      return errors.internal("Failed to remove from trending", "Remove Trending");
    }

    return apiSuccess({
      success: true,
      message: "Trip removed from trending",
    });
  } catch (error) {
    console.error("[Remove Trending] Unexpected error:", error);
    return errors.internal("Internal server error", "Remove Trending");
  }
}
