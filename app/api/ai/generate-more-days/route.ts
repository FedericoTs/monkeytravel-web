import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMoreDays, INITIAL_DAYS_TO_GENERATE } from "@/lib/gemini";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkEarlyAccess, incrementEarlyAccessUsage } from "@/lib/early-access";
import type { ItineraryDay } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * Generate additional days for an existing trip
 * POST /api/ai/generate-more-days
 *
 * Used for incremental loading of long trips (5+ days)
 * Generates days beyond the initial 3-day partial generation
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Check early access (during early access period)
    const earlyAccess = await checkEarlyAccess(user.id, "generation", user.email);
    if (!earlyAccess.allowed) {
      return errors.forbidden(earlyAccess.message || "Early access required", earlyAccess.error);
    }

    // Parse request body
    const body = await request.json();
    const {
      tripId,
      destination,
      startDate,
      endDate,
      budgetTier,
      pace,
      vibes,
      existingDays,
      startFromDay,
      daysToGenerate,
    } = body as {
      tripId?: string;
      destination: string;
      startDate: string;
      endDate: string;
      budgetTier: "budget" | "balanced" | "premium";
      pace: "relaxed" | "moderate" | "packed";
      vibes: string[];
      existingDays: ItineraryDay[];
      startFromDay: number;
      daysToGenerate: number;
    };

    // Validate required fields
    if (!destination || !startDate || !endDate || !existingDays || !startFromDay || !daysToGenerate) {
      return errors.badRequest("Missing required fields");
    }

    // Check API access control
    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/generate-more-days",
        status: 503,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: `BLOCKED: ${access.message}`,
        metadata: { user_id: user.id },
      });
      return errors.serviceUnavailable(access.message || "AI generation is currently disabled");
    }

    // Check usage limits (tier-based monthly limits)
    // Note: generate-more-days counts toward the same aiGenerations limit
    // as it's part of the trip generation flow
    const usageCheck = await checkUsageLimit(user.id, "aiGenerations", user.email);
    if (!usageCheck.allowed) {
      return errors.rateLimit(
        usageCheck.message || "Monthly trip generation limit reached.",
        { usage: usageCheck, upgradeUrl: "/pricing" }
      );
    }

    // Generate additional days
    console.log(
      `[AI Generate More] Starting generation for ${destination}, days ${startFromDay}-${startFromDay + daysToGenerate - 1}`
    );

    const newDays = await generateMoreDays({
      destination,
      startDate,
      endDate,
      budgetTier,
      pace,
      vibes,
      existingDays,
      startFromDay,
      daysToGenerate,
    });

    const generationTime = Date.now() - startTime;

    // Log the API call
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/generate-more-days",
      status: 200,
      responseTimeMs: generationTime,
      cacheHit: false,
      costUsd: 0.002, // Slightly less than full generation since it's fewer days
      metadata: {
        user_id: user.id,
        trip_id: tripId,
        destination,
        start_from_day: startFromDay,
        days_generated: newDays.length,
        tier: usageCheck.tier,
      },
    });

    // Increment usage counter (continuation counts as a generation)
    await incrementUsage(user.id, "aiGenerations", 1);
    // Also increment early access usage
    await incrementEarlyAccessUsage(user.id, "generation");

    // Update usage info for response
    const updatedUsage = {
      ...usageCheck,
      used: usageCheck.used + 1,
      remaining: Math.max(0, usageCheck.remaining - 1),
    };

    // If tripId is provided, update the trip in the database
    if (tripId) {
      const { data: existingTrip } = await supabase
        .from("trips")
        .select("itinerary")
        .eq("id", tripId)
        .eq("user_id", user.id)
        .single();

      if (existingTrip?.itinerary) {
        const currentItinerary = existingTrip.itinerary as { days: ItineraryDay[] };
        const updatedDays = [...currentItinerary.days, ...newDays];

        await supabase
          .from("trips")
          .update({
            itinerary: {
              ...currentItinerary,
              days: updatedDays,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", tripId)
          .eq("user_id", user.id);
      }
    }

    // Calculate if there are more days to generate
    const totalDays =
      Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;
    const generatedSoFar = existingDays.length + newDays.length;
    const hasMoreDays = generatedSoFar < totalDays;
    const nextStartDay = hasMoreDays ? generatedSoFar + 1 : null;
    const remainingDays = hasMoreDays ? totalDays - generatedSoFar : 0;

    return apiSuccess({
      success: true,
      days: newDays,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.5-flash-lite",
        startFromDay,
        daysGenerated: newDays.length,
        totalDays,
        generatedSoFar,
        hasMoreDays,
        nextStartDay,
        remainingDays,
      },
      usage: updatedUsage,
    });
  } catch (error) {
    console.error("[AI Generate More] Generation error:", error);

    // Log error
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/generate-more-days",
      status: 500,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return errors.internal("Failed to generate additional days. Please try again.", "AI Generate More Days");
  }
}
