import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { regenerateSingleActivity } from "@/lib/gemini";
import { findActivityById, getAllActivityNames } from "@/lib/utils/activity-id";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
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

    // Check API access control
    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/regenerate-activity",
        status: 503,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: `BLOCKED: ${access.message}`,
        metadata: { user_id: user.id, trip_id: tripId },
      });
      return NextResponse.json(
        { error: access.message || "AI regeneration is currently disabled" },
        { status: 503 }
      );
    }

    // Check usage limits (tier-based monthly limits)
    const usageCheck = await checkUsageLimit(user.id, "aiRegenerations", user.email);
    if (!usageCheck.allowed) {
      return NextResponse.json(
        {
          error: usageCheck.message || "Monthly activity regeneration limit reached.",
          usage: usageCheck,
          upgradeUrl: "/pricing",
        },
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

    // Log the request using centralized gateway
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/regenerate-activity",
      status: 200,
      responseTimeMs: generationTime,
      cacheHit: false,
      costUsd: 0.001,
      metadata: {
        user_id: user.id,
        trip_id: tripId,
        activity_id: activityId,
        destination,
      },
    });

    // Increment usage counter
    await incrementUsage(user.id, "aiRegenerations", 1);

    // Update usage info for response
    const updatedUsage = {
      ...usageCheck,
      used: usageCheck.used + 1,
      remaining: Math.max(0, usageCheck.remaining - 1),
    };

    return NextResponse.json({
      success: true,
      activity: newActivity,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.0-flash",
      },
      usage: updatedUsage,
    });
  } catch (error) {
    console.error("Activity regeneration error:", error);

    // Log error using centralized gateway
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/regenerate-activity",
      status: 500,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Failed to regenerate activity. Please try again." },
      { status: 500 }
    );
  }
}
