import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateItinerary, validateTripParams } from "@/lib/gemini";
import { isAdmin } from "@/lib/admin";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import type { TripCreationParams, UserProfilePreferences, GeneratedItinerary } from "@/types";
import crypto from "crypto";

/**
 * Generate a hash for destination-based cache lookup
 * Normalizes destination name for consistent matching
 */
function hashDestination(destination: string): string {
  const normalized = destination.toLowerCase().trim().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Check if cached activities can be reused for this request
 * Matches by destination, vibes, and budget tier
 */
async function getCachedItinerary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  destination: string,
  vibes: string[],
  budgetTier: string
): Promise<GeneratedItinerary | null> {
  const destinationHash = hashDestination(destination);
  const sortedVibes = [...vibes].sort();

  const { data, error } = await supabase
    .from("destination_activity_cache")
    .select("*")
    .eq("destination_hash", destinationHash)
    .eq("budget_tier", budgetTier)
    .contains("vibes", sortedVibes)
    .gt("expires_at", new Date().toISOString())
    .order("hit_count", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  // Update hit count asynchronously
  supabase
    .from("destination_activity_cache")
    .update({
      hit_count: (data.hit_count || 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    .then(() => {});

  console.log(`[AI Generate] Cache HIT for ${destination} (vibes: ${vibes.join(", ")})`);

  return {
    destination: data.trip_summary?.destination || { name: destination, country: "", description: "" },
    days: data.activities,
    trip_summary: data.trip_summary?.trip_summary,
    booking_links: data.trip_summary?.booking_links,
  } as GeneratedItinerary;
}

/**
 * Cache the generated itinerary for future users with similar queries
 */
async function cacheItinerary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  destination: string,
  vibes: string[],
  budgetTier: string,
  itinerary: GeneratedItinerary
): Promise<void> {
  const destinationHash = hashDestination(destination);
  const sortedVibes = [...vibes].sort();

  // Cache for 14 days (extended from 7)
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    const { error } = await supabase.from("destination_activity_cache").upsert(
      {
        destination_hash: destinationHash,
        destination_name: destination,
        vibes: sortedVibes,
        budget_tier: budgetTier,
        activities: itinerary.days,
        trip_summary: {
          destination: itinerary.destination,
          trip_summary: itinerary.trip_summary,
          booking_links: itinerary.booking_links,
        },
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "destination_hash,vibes,budget_tier" }
    );

    if (error) {
      console.error(`[AI Generate] Cache write error for ${destination}:`, error.message, error.details);
    } else {
      console.log(`[AI Generate] Cached itinerary for ${destination} (vibes: ${sortedVibes.join(", ")}, budget: ${budgetTier})`);
    }
  } catch (err) {
    console.error("[AI Generate] Cache write exception:", err);
  }
}

/**
 * Adjust cached itinerary dates to match the user's requested dates
 */
function adjustItineraryDates(
  itinerary: GeneratedItinerary,
  startDate: string,
  endDate: string
): GeneratedItinerary {
  const start = new Date(startDate);
  const requestedDays = Math.ceil(
    (new Date(endDate).getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  // Adjust each day's date
  const adjustedDays = itinerary.days.slice(0, requestedDays).map((day, index) => {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + index);
    return {
      ...day,
      day_number: index + 1,
      date: dayDate.toISOString().split("T")[0],
    };
  });

  return {
    ...itinerary,
    days: adjustedDays,
  };
}

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

    // Fetch user's profile preferences to include in trip generation
    let profilePreferences: UserProfilePreferences = {};
    try {
      const { data: userProfile } = await supabase
        .from("users")
        .select("preferences")
        .eq("id", user.id)
        .single();

      if (userProfile?.preferences) {
        const prefs = userProfile.preferences as Record<string, unknown>;
        profilePreferences = {
          dietaryPreferences: prefs.dietaryPreferences as string[] | undefined,
          travelStyles: prefs.travelStyles as string[] | undefined,
          accessibilityNeeds: prefs.accessibilityNeeds as string[] | undefined,
        };
      }
    } catch (err) {
      // Log but don't fail if profile fetch fails
      console.warn("Could not fetch user preferences:", err);
    }

    // Parse request body
    const body = await request.json();
    const params: TripCreationParams = {
      destination: body.destination,
      startDate: body.startDate,
      endDate: body.endDate,
      budgetTier: body.budgetTier || "balanced",
      pace: body.pace || "moderate",
      vibes: body.vibes || [],
      seasonalContext: body.seasonalContext,
      interests: body.interests || [],
      requirements: body.requirements,
      // Include profile preferences (automatically fetched from user profile)
      profilePreferences,
    };

    // Validate input
    const validation = validateTripParams(params);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Check API access control first
    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/generate",
        status: 503,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: `BLOCKED: ${access.message}`,
        metadata: { user_id: user.id },
      });
      return NextResponse.json(
        { error: access.message || "AI generation is currently disabled" },
        { status: 503 }
      );
    }

    // Check rate limits (10 generations per day for regular users, unlimited for admins)
    const userIsAdmin = isAdmin(user.email);

    if (!userIsAdmin) {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("api_request_logs")
        .select("*", { count: "exact", head: true })
        .eq("api_name", "gemini")
        .gte("timestamp", `${today}T00:00:00Z`)
        .eq("request_params->>user_id", user.id);

      if ((count || 0) >= 10) {
        return NextResponse.json(
          { error: "Daily generation limit reached. Try again tomorrow." },
          { status: 429 }
        );
      }
    }

    // Check cross-user cache first for same destination + vibes + budget
    // This can reduce AI costs by 40-60% for popular destinations
    let itinerary: GeneratedItinerary;
    let cacheHit = false;

    const cachedItinerary = await getCachedItinerary(
      supabase,
      params.destination,
      params.vibes,
      params.budgetTier
    );

    if (cachedItinerary && cachedItinerary.days.length >= 1) {
      // Cache hit - adjust dates to user's requested range
      itinerary = adjustItineraryDates(cachedItinerary, params.startDate, params.endDate);
      cacheHit = true;
      console.log(`[AI Generate] Using cached itinerary for ${params.destination}`);
    } else {
      // Cache miss - generate fresh itinerary
      console.log(`[AI Generate] Cache MISS for ${params.destination}, generating fresh...`);
      itinerary = await generateItinerary(params);

      // Cache the result for future users (async, don't wait)
      cacheItinerary(supabase, params.destination, params.vibes, params.budgetTier, itinerary);
    }

    const generationTime = Date.now() - startTime;

    // Log the request using centralized gateway
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/generate",
      status: 200,
      responseTimeMs: generationTime,
      cacheHit,
      costUsd: cacheHit ? 0 : 0.003, // Only charge for AI calls, not cache hits
      metadata: {
        user_id: user.id,
        destination: params.destination,
        vibes: params.vibes,
        duration:
          Math.ceil(
            (new Date(params.endDate).getTime() -
              new Date(params.startDate).getTime()) /
              (1000 * 60 * 60 * 24)
          ) + 1,
        is_admin: userIsAdmin,
      },
    });

    return NextResponse.json({
      success: true,
      itinerary,
      meta: {
        generationTimeMs: generationTime,
        model: cacheHit ? "cache" : "gemini-2.0-flash",
        cached: cacheHit,
      },
    });
  } catch (error) {
    console.error("Generation error:", error);

    // Log error using centralized gateway
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/generate",
      status: 500,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Failed to generate itinerary. Please try again." },
      { status: 500 }
    );
  }
}
