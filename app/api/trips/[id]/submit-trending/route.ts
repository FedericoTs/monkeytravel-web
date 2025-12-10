import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id, visibility, share_token, submitted_to_trending_at")
      .eq("id", id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: "Trip not found" },
        { status: 404 }
      );
    }

    if (trip.user_id !== user.id) {
      return NextResponse.json(
        { error: "Not authorized to modify this trip" },
        { status: 403 }
      );
    }

    // Trip must be shared first
    if (!trip.share_token) {
      return NextResponse.json(
        { error: "Trip must be shared before submitting to trending" },
        { status: 400 }
      );
    }

    // Already submitted
    if (trip.submitted_to_trending_at) {
      return NextResponse.json({
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
      return NextResponse.json(
        { error: "Failed to submit to trending" },
        { status: 500 }
      );
    }

    // Update trending score
    await supabase.rpc("update_trip_trending_score", { p_trip_id: id });

    return NextResponse.json({
      success: true,
      message: "Trip submitted to trending!",
    });
  } catch (error) {
    console.error("[Submit Trending] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: "Trip not found" },
        { status: 404 }
      );
    }

    if (trip.user_id !== user.id) {
      return NextResponse.json(
        { error: "Not authorized to modify this trip" },
        { status: 403 }
      );
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
      return NextResponse.json(
        { error: "Failed to remove from trending" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Trip removed from trending",
    });
  } catch (error) {
    console.error("[Remove Trending] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
