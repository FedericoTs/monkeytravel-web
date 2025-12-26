import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
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
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify trip ownership with needed fields
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      "id, user_id, visibility, share_token, submitted_to_trending_at"
    );
    if (tripError) return tripError;

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
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify trip ownership
    const { errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id
    );
    if (tripError) return tripError;

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
