import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { regenerateSingleActivity } from "@/lib/gemini";
import { findActivityById, getAllActivityNames } from "@/lib/utils/activity-id";
import type { ItineraryDay } from "@/types";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const {
      tripId,
      activityId,
      dayIndex,
      destination,
      itinerary,
      preferences,
    } = body as {
      tripId: string;
      activityId: string;
      dayIndex: number;
      destination: string;
      itinerary: ItineraryDay[];
      preferences?: {
        category?: "attraction" | "restaurant" | "activity" | "transport";
        similarTo?: boolean;
      };
    };

    // Validate required fields
    if (!tripId || !activityId || dayIndex === undefined || !destination || !itinerary) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id, budget")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // Find the activity to replace
    const activityLocation = findActivityById(itinerary, activityId);
    if (!activityLocation) {
      return NextResponse.json(
        { error: "Activity not found in itinerary" },
        { status: 404 }
      );
    }

    const { activity: activityToReplace } = activityLocation;
    const dayContext = itinerary[dayIndex];

    if (!dayContext) {
      return NextResponse.json(
        { error: "Invalid day index" },
        { status: 400 }
      );
    }

    // Check rate limits (10 regenerations per trip per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("api_request_logs")
      .select("*", { count: "exact", head: true })
      .eq("api_name", "gemini")
      .eq("endpoint", "/api/ai/regenerate-activity")
      .gte("timestamp", oneHourAgo)
      .eq("request_params->>trip_id", tripId);

    if ((count || 0) >= 10) {
      return NextResponse.json(
        { error: "Rate limit reached. You can regenerate up to 10 activities per hour per trip." },
        { status: 429 }
      );
    }

    // Get all existing activity names to avoid duplicates
    const existingActivityNames = getAllActivityNames(itinerary);

    // Determine budget tier from trip data (default to balanced)
    const budgetTier = trip.budget?.tier || "balanced";

    // Generate new activity
    const newActivity = await regenerateSingleActivity({
      destination,
      activityToReplace,
      dayContext,
      budgetTier: budgetTier as "budget" | "balanced" | "premium",
      existingActivityNames,
      preferences,
    });

    const generationTime = Date.now() - startTime;

    // Log the request
    await supabase.from("api_request_logs").insert({
      api_name: "gemini",
      endpoint: "/api/ai/regenerate-activity",
      request_params: {
        user_id: user.id,
        trip_id: tripId,
        activity_id: activityId,
        destination,
      },
      response_status: 200,
      response_time_ms: generationTime,
      cache_hit: false,
      cost_usd: 0.001, // Lower cost for single activity
    });

    return NextResponse.json({
      success: true,
      activity: newActivity,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.0-flash",
      },
    });
  } catch (error) {
    console.error("Activity regeneration error:", error);

    // Log error
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("api_request_logs").insert({
      api_name: "gemini",
      endpoint: "/api/ai/regenerate-activity",
      request_params: { user_id: user?.id },
      response_status: 500,
      response_time_ms: Date.now() - startTime,
      error_message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Failed to regenerate activity. Please try again." },
      { status: 500 }
    );
  }
}
