import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id]/activities - Get all activity timelines for a trip
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // Fetch all activity timelines for this trip
    const { data: timelines, error } = await supabase
      .from("activity_timelines")
      .select("*")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .order("day_number", { ascending: true });

    if (error) {
      console.error("Error fetching activity timelines:", error);
      return NextResponse.json(
        { error: "Failed to fetch activity timelines" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, timelines: timelines || [] });
  } catch (error) {
    console.error("Error fetching activity timelines:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity timelines" },
      { status: 500 }
    );
  }
}
