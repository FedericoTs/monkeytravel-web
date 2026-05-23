/**
 * POST /api/ai/regenerate-day
 *
 * Regenerate a SINGLE day within an existing trip's itinerary. Users who
 * want a different Day 3 (e.g. "this day was the weakest") can call this
 * without nuking Days 1, 2, 4, 5… as the whole-trip regenerate does.
 *
 * Request body:
 *   {
 *     tripId: string,
 *     dayNumber: number,   // 1-indexed, must exist in trip.itinerary
 *     instructions?: string // optional user steering, e.g. "more relaxed"
 *   }
 *
 * Response: { success: true, day: ItineraryDay, meta: {...} }
 *
 * Mirrors regenerate-activity for auth, ownership, usage, gateway logging.
 */

import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { regenerateSingleDay } from "@/lib/gemini";
import { fetchActivityImages } from "@/lib/images/activity";
import { sanitizeItinerary } from "@/lib/utils/sanitize";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkEarlyAccess, incrementEarlyAccessUsage } from "@/lib/early-access";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { ItineraryDay, TripVibe } from "@/types";

type SupportedLanguage = "en" | "es" | "it";

async function getUserLanguage(): Promise<SupportedLanguage> {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");
  if (localeCookie?.value && ["en", "es", "it"].includes(localeCookie.value)) {
    return localeCookie.value as SupportedLanguage;
  }
  return "en";
}

const MAX_INSTRUCTIONS_LEN = 500;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Early-access gate (same surface as regenerate-activity)
    const earlyAccess = await checkEarlyAccess(user.id, "regeneration", user.email);
    if (!earlyAccess.allowed) {
      return errors.forbidden(
        earlyAccess.message || "Early access required",
        earlyAccess.error
      );
    }

    // Parse + validate body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errors.badRequest("Invalid request body");
    }

    const { tripId, dayNumber, instructions } = body as {
      tripId?: unknown;
      dayNumber?: unknown;
      instructions?: unknown;
    };

    if (typeof tripId !== "string" || !tripId) {
      return errors.badRequest("Missing or invalid tripId");
    }
    if (typeof dayNumber !== "number" || !Number.isInteger(dayNumber) || dayNumber < 1) {
      return errors.badRequest("Missing or invalid dayNumber (must be a positive integer)");
    }
    if (instructions !== undefined && (typeof instructions !== "string" || instructions.length > MAX_INSTRUCTIONS_LEN)) {
      return errors.badRequest(
        `instructions must be a string under ${MAX_INSTRUCTIONS_LEN} chars`
      );
    }

    // Verify ownership AND fetch the fields we need in one round-trip.
    const { trip, errorResponse: ownershipError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id,
      "id, user_id, title, itinerary, budget, tags"
    );
    if (ownershipError) return ownershipError;

    const itinerary = (trip!.itinerary as ItineraryDay[] | null) ?? [];
    if (!Array.isArray(itinerary) || itinerary.length === 0) {
      return errors.badRequest("Trip has no itinerary to regenerate");
    }

    const dayIndex = itinerary.findIndex((d) => d.day_number === dayNumber);
    if (dayIndex === -1) {
      return errors.badRequest(
        `Day ${dayNumber} not found in trip (trip has ${itinerary.length} day${itinerary.length === 1 ? "" : "s"})`
      );
    }

    const oldDay = itinerary[dayIndex];

    // API gateway access check
    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/regenerate-day",
        status: 503,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: `BLOCKED: ${access.message}`,
        metadata: { user_id: user.id, trip_id: tripId, day_number: dayNumber },
      });
      return errors.serviceUnavailable(
        access.message || "AI regeneration is currently disabled"
      );
    }

    // Usage limits (reuse the same bucket as activity regen — it's still a Gemini call)
    const usageCheck = await checkUsageLimit(user.id, "aiRegenerations", user.email);
    if (!usageCheck.allowed) {
      return errors.rateLimit(
        usageCheck.message || "Monthly regeneration limit reached.",
        { usage: usageCheck, upgradeUrl: "/pricing" }
      );
    }

    // Derive trip context. Vibes/pace aren't persisted on the row today
    // (see lib/trips/persistTrip.ts) so fall back to reasonable defaults
    // based on the tags column (which mirrors derivedInterests).
    const budgetTier = (trip!.budget as { tier?: string } | null)?.tier as
      | "budget"
      | "balanced"
      | "premium"
      | undefined;
    const tags = (trip!.tags as string[] | null) ?? [];
    const inferredVibes: TripVibe[] = tags
      .filter((t): t is TripVibe =>
        ["adventure", "cultural", "foodie", "wellness", "romantic", "urban", "nature", "offbeat", "wonderland", "movie-magic", "fairytale", "retro"].includes(t)
      );

    // Destination — strip the " Trip" suffix the title carries (e.g. "Rome Trip" -> "Rome")
    const destination = ((trip!.title as string | undefined) ?? "").replace(/ Trip$/, "") || (trip!.title as string);

    const language = await getUserLanguage();

    // The surrounding days are everything except the one we're replacing.
    const surroundingDays = itinerary.filter((_, i) => i !== dayIndex);

    // Call Gemini
    let newDay: ItineraryDay;
    try {
      newDay = await regenerateSingleDay({
        destination,
        dayNumber,
        date: oldDay.date,
        budgetTier: budgetTier ?? "balanced",
        pace: "moderate",
        vibes: inferredVibes,
        surroundingDays,
        instructions: typeof instructions === "string" ? instructions : undefined,
        language,
        userId: user.id,
      });
    } catch (geminiError) {
      console.error("[AI Regenerate Day] Gemini call failed:", geminiError);
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/regenerate-day",
        status: 500,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: geminiError instanceof Error ? geminiError.message : "Unknown Gemini error",
        metadata: { user_id: user.id, trip_id: tripId, day_number: dayNumber },
      });
      // Do NOT touch the DB — bail out cleanly so the existing day stays intact.
      return errors.internal(
        "Failed to regenerate day. Please try again.",
        "Day Regeneration"
      );
    }

    if (!newDay || !Array.isArray(newDay.activities) || newDay.activities.length === 0) {
      console.error("[AI Regenerate Day] Empty result from Gemini");
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/regenerate-day",
        status: 500,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: "Empty day returned",
        metadata: { user_id: user.id, trip_id: tripId, day_number: dayNumber },
      });
      return errors.internal(
        "Day regeneration returned no activities. Please try again.",
        "Day Regeneration"
      );
    }

    // Fetch images for the new activities (operates on [day] for ergonomics)
    try {
      await fetchActivityImages([newDay], destination);
    } catch (imgError) {
      // Image fetch failures are non-fatal — the day is still usable.
      console.warn("[AI Regenerate Day] Image fetch failed:", imgError);
    }

    // Sanitize via the itinerary helper (it handles a `days` array, so
    // wrap and unwrap). Result keeps the day's shape intact.
    const sanitizedWrapper = sanitizeItinerary({ days: [newDay] } as { days: ItineraryDay[] });
    const sanitizedDay = sanitizedWrapper.days[0];

    // Splice the new day back into the itinerary and persist.
    const updatedItinerary = itinerary.slice();
    updatedItinerary[dayIndex] = sanitizedDay;

    const { error: updateError } = await supabase
      .from("trips")
      .update({ itinerary: updatedItinerary })
      .eq("id", tripId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[AI Regenerate Day] DB update failed:", updateError);
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/regenerate-day",
        status: 500,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0.0015,
        error: `DB update failed: ${updateError.message}`,
        metadata: { user_id: user.id, trip_id: tripId, day_number: dayNumber },
      });
      return errors.internal("Failed to save regenerated day", "Day Regeneration");
    }

    const generationTime = Date.now() - startTime;

    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/regenerate-day",
      status: 200,
      responseTimeMs: generationTime,
      cacheHit: false,
      costUsd: 0.0015, // ~50% more than a single-activity regen; one day = ~3-5 activities
      metadata: {
        user_id: user.id,
        trip_id: tripId,
        day_number: dayNumber,
        destination,
        activities_count: sanitizedDay.activities.length,
      },
    });

    // Bump usage counters
    await incrementUsage(user.id, "aiRegenerations", 1);
    await incrementEarlyAccessUsage(user.id, "regeneration");

    const updatedUsage = {
      ...usageCheck,
      used: usageCheck.used + 1,
      remaining: Math.max(0, usageCheck.remaining - 1),
    };

    return apiSuccess({
      success: true,
      day: sanitizedDay,
      dayIndex,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.5-flash-lite",
      },
      usage: updatedUsage,
    });
  } catch (error) {
    console.error("[AI Regenerate Day] Unexpected error:", error);
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/regenerate-day",
      status: 500,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return errors.internal(
      "Failed to regenerate day. Please try again.",
      "Day Regeneration"
    );
  }
}
