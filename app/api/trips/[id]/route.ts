import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import type { ItineraryDay } from "@/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id] - Fetch a single trip
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch trip
    const { data: trip, error } = await supabase
      .from("trips")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, trip });
  } catch (error) {
    console.error("Error fetching trip:", error);
    return NextResponse.json(
      { error: "Failed to fetch trip" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/trips/[id] - Update trip (supports itinerary updates)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership
    const { data: existingTrip, error: fetchError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTrip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
        return NextResponse.json(
          { error: "Invalid itinerary format" },
          { status: 400 }
        );
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
      console.error("Error updating trip:", updateError);
      return NextResponse.json(
        { error: "Failed to update trip" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      trip: updatedTrip,
    });
  } catch (error) {
    console.error("Error updating trip:", error);
    return NextResponse.json(
      { error: "Failed to update trip" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id] - Delete a trip
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete trip (only if owned by user)
    const { error } = await supabase
      .from("trips")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting trip:", error);
      return NextResponse.json(
        { error: "Failed to delete trip" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting trip:", error);
    return NextResponse.json(
      { error: "Failed to delete trip" },
      { status: 500 }
    );
  }
}
