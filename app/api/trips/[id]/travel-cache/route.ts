import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CachedDayTravelData, TripMeta } from "@/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface TravelCacheBody {
  travel_distances: CachedDayTravelData[];
  travel_distances_hash: string;
}

/**
 * POST /api/trips/[id]/travel-cache
 * Saves calculated travel distances to trip_meta for persistence
 * These are calculated locally using Haversine formula - no external API costs
 */
export async function POST(request: NextRequest, context: RouteContext) {
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

    // Verify trip ownership and get current trip_meta
    const { data: trip, error: fetchError } = await supabase
      .from("trips")
      .select("id, user_id, trip_meta")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // Parse request body
    const body: TravelCacheBody = await request.json();

    if (!body.travel_distances || !body.travel_distances_hash) {
      return NextResponse.json(
        { error: "Missing travel_distances or travel_distances_hash" },
        { status: 400 }
      );
    }

    // Merge with existing trip_meta
    const existingMeta = (trip.trip_meta as TripMeta) || {};
    const updatedMeta: TripMeta = {
      ...existingMeta,
      travel_distances: body.travel_distances,
      travel_distances_hash: body.travel_distances_hash,
    };

    // Update trip_meta
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        trip_meta: updatedMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Error updating travel cache:", updateError);
      return NextResponse.json(
        { error: "Failed to save travel cache" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Travel distances cached successfully",
    });
  } catch (error) {
    console.error("Error in travel-cache API:", error);
    return NextResponse.json(
      { error: "Failed to save travel cache" },
      { status: 500 }
    );
  }
}
