import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { regenerateSingleActivity } from "@/lib/gemini";
import { findActivityById, getAllActivityNames } from "@/lib/utils/activity-id";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkEarlyAccess, incrementEarlyAccessUsage } from "@/lib/early-access";
import type { ItineraryDay } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Check early access (during early access period)
    const earlyAccess = await checkEarlyAccess(user.id, "regeneration", user.email);
    if (!earlyAccess.allowed) {
      return errors.forbidden(earlyAccess.message || "Early access required", earlyAccess.error);
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
      return errors.badRequest("Missing required fields");
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id, budget")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    // Find the activity to replace
    const activityLocation = findActivityById(itinerary, activityId);
    if (!activityLocation) {
      return errors.notFound("Activity not found in itinerary");
    }

    const { activity: activityToReplace } = activityLocation;
    const dayContext = itinerary[dayIndex];

    if (!dayContext) {
      return errors.badRequest("Invalid day index");
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
      return errors.serviceUnavailable(access.message || "AI regeneration is currently disabled");
    }

    // Check usage limits (tier-based monthly limits)
    const usageCheck = await checkUsageLimit(user.id, "aiRegenerations", user.email);
    if (!usageCheck.allowed) {
      return errors.rateLimit(
        usageCheck.message || "Monthly activity regeneration limit reached.",
        { usage: usageCheck, upgradeUrl: "/pricing" }
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
    // Also increment early access usage
    await incrementEarlyAccessUsage(user.id, "regeneration");

    // Update usage info for response
    const updatedUsage = {
      ...usageCheck,
      used: usageCheck.used + 1,
      remaining: Math.max(0, usageCheck.remaining - 1),
    };

    return apiSuccess({
      success: true,
      activity: newActivity,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.5-flash-lite",
      },
      usage: updatedUsage,
    });
  } catch (error) {
    console.error("[AI Regenerate] Activity regeneration error:", error);

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

    return errors.internal("Failed to regenerate activity. Please try again.", "Activity Regeneration");
  }
}
