import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";
import { checkAnonymousRateLimit, recordAnonymousGeneration } from "@/lib/anonymous/rate-limit";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  generateItinerary,
  validateTripParams,
  shouldUseIncrementalGeneration,
  INITIAL_DAYS_TO_GENERATE,
  INCREMENTAL_GENERATION_THRESHOLD,
} from "@/lib/gemini";
import {
  generateItineraryWithMapsGrounding,
  isMapsGroundingAvailable,
  getMapsGroundingCost,
} from "@/lib/maps-grounding";
import { isAdmin } from "@/lib/admin";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkEarlyAccess, incrementEarlyAccessUsage, decrementFreeTrips } from "@/lib/early-access";
import { isActivityBankPopulated, populateActivityBank } from "@/lib/activity-bank";
import { fetchActivityImages } from "@/lib/images/activity";
import { sanitizeItinerary } from "@/lib/utils/sanitize";
import type { TripCreationParams, UserProfilePreferences, GeneratedItinerary } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import crypto from "crypto";
import { cookies } from "next/headers";

type SupportedLanguage = "en" | "es" | "it";

/**
 * Get the user's preferred language from cookies or profile.
 * For anonymous users (userId === null) we use only the locale cookie.
 */
async function getUserLanguage(
  supabase: SupabaseClient,
  userId: string | null
): Promise<SupportedLanguage> {
  // First check for locale cookie (set by next-intl middleware) — works for
  // both authenticated and anonymous users.
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");
  if (localeCookie?.value && ["en", "es", "it"].includes(localeCookie.value)) {
    return localeCookie.value as SupportedLanguage;
  }

  // Authenticated: fall back to profile preference
  if (userId) {
    try {
      const { data: profile } = await supabase
        .from("users")
        .select("preferred_language")
        .eq("id", userId)
        .single();

      if (profile?.preferred_language && ["en", "es", "it"].includes(profile.preferred_language)) {
        return profile.preferred_language as SupportedLanguage;
      }
    } catch {
      // Ignore errors, use default
    }
  }

  return "en";
}

// Feature flag: Enable Maps Grounding for cost-effective generation
// Set USE_MAPS_GROUNDING=true in .env to enable (59% cost savings)
const USE_MAPS_GROUNDING = process.env.USE_MAPS_GROUNDING === "true";

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
 * Matches by destination, vibes, budget tier, and language
 */
async function getCachedItinerary(
  supabase: SupabaseClient,
  destination: string,
  vibes: string[],
  budgetTier: string,
  language: SupportedLanguage
): Promise<GeneratedItinerary | null> {
  const destinationHash = hashDestination(destination);
  const sortedVibes = [...vibes].sort();

  const { data, error } = await supabase
    .from("destination_activity_cache")
    .select("*")
    .eq("destination_hash", destinationHash)
    .eq("budget_tier", budgetTier)
    .eq("language", language)
    .contains("vibes", sortedVibes)
    .gt("expires_at", new Date().toISOString())
    .order("hit_count", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  // Update hit count atomically using raw SQL increment
  Promise.resolve(
    supabase.rpc("increment_cache_hit_count", { cache_id: data.id })
  ).catch(() => {
    // Fallback: non-atomic update if RPC not available
    supabase
      .from("destination_activity_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .then(() => {});
  });

  console.log(`[AI Generate] Cache HIT for ${destination} (vibes: ${vibes.join(", ")}, language: ${language})`);

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
  supabase: SupabaseClient,
  destination: string,
  vibes: string[],
  budgetTier: string,
  language: SupportedLanguage,
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
        language: language,
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
      { onConflict: "unique_destination_cache_lang" }
    );

    if (error) {
      console.error(`[AI Generate] Cache write error for ${destination}:`, error.message, error.details);
    } else {
      console.log(`[AI Generate] Cached itinerary for ${destination} (vibes: ${sortedVibes.join(", ")}, budget: ${budgetTier}, language: ${language})`);
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
    // **2026-05-23**: Anonymous generation enabled (per conversion audit).
    // Visitors can generate one trip without signing up — the auth wall
    // fires at Save instead. This is the single biggest conversion lift
    // available (75% of generators previously never reached trip_created
    // because of the post-fill signup modal).
    //
    // Auth flow: try to get the user; if absent, we're in anonymous mode.
    // Rate-limit anonymous users via cookie to prevent obvious abuse.
    const supabase = await createClient();
    const { data: { user: maybeUser } } = await supabase.auth.getUser();
    const user: User | null = maybeUser ?? null;
    const isAnonymous = user === null;

    let anonLimit: Awaited<ReturnType<typeof checkAnonymousRateLimit>> | null = null;
    if (isAnonymous) {
      anonLimit = await checkAnonymousRateLimit();
      if (!anonLimit.allowed) {
        return errors.rateLimit(
          anonLimit.message || "Free trip limit reached. Sign up to keep generating.",
          { usage: anonLimit, signupUrl: "/auth/signup" }
        );
      }
    }

    // Personalization comes from the user profile — only for authenticated
    // users. Anonymous users supply preferences directly in the wizard form.
    let profilePreferences: UserProfilePreferences = {};
    if (user) {
      try {
        const { data: userProfile } = await supabase
          .from("users")
          .select("preferences, notification_settings")
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

        // Convert quiet hours to active hours for activity scheduling
        // Quiet hours are when user rests, so active hours are the inverse
        if (userProfile?.notification_settings) {
          const notifSettings = userProfile.notification_settings as Record<string, unknown>;
          const quietStart = notifSettings.quietHoursStart as number | undefined;
          const quietEnd = notifSettings.quietHoursEnd as number | undefined;

          if (quietStart !== undefined && quietEnd !== undefined) {
            profilePreferences.activeHoursStart = quietEnd;
            profilePreferences.activeHoursEnd = quietStart;
          }
        }
      } catch (err) {
        console.warn("[AI Generate] Could not fetch user preferences:", err);
      }
    }

    // Get preferred language for AI content localization (cookie-based for anon)
    const userLanguage = await getUserLanguage(supabase, user?.id ?? null);
    console.log(`[AI Generate] User language: ${userLanguage} (anonymous=${isAnonymous})`);

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
      return errors.badRequest(validation.error);
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
        metadata: { user_id: user?.id ?? "anonymous" },
      });
      return errors.serviceUnavailable(access.message || "AI generation is currently disabled");
    }

    // Authenticated-tier usage limits (anonymous is rate-limited above via
    // cookie; authenticated users are unlimited per the 2026-05-23 free-tier
    // decision but we keep checkUsageLimit wired so analytics still tracks).
    const userIsAdmin = user ? isAdmin(user.email) : false;
    const usageCheck = user
      ? await checkUsageLimit(user.id, "aiGenerations", user.email)
      : { allowed: true, used: 0, remaining: 999, limit: 999 };

    if (user && !usageCheck.allowed) {
      return errors.rateLimit(
        usageCheck.message || "Monthly trip generation limit reached.",
        { usage: usageCheck, upgradeUrl: "/pricing" }
      );
    }

    // Check cross-user cache first for same destination + vibes + budget
    // This can reduce AI costs by 40-60% for popular destinations
    let itinerary: GeneratedItinerary;
    let cacheHit = false;
    let isPartialGeneration = false;
    let usedMapsGrounding = false;

    // Calculate total trip duration
    const totalDays = Math.ceil(
      (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

    // Determine if we should use incremental generation for long trips
    const useIncremental = shouldUseIncrementalGeneration(params.startDate, params.endDate);

    const cachedItinerary = await getCachedItinerary(
      supabase,
      params.destination,
      params.vibes,
      params.budgetTier,
      userLanguage
    );

    if (cachedItinerary && cachedItinerary.days.length >= 1) {
      // Cache hit - adjust dates and sanitize (defense-in-depth: treat cached data as untrusted)
      itinerary = sanitizeItinerary(adjustItineraryDates(cachedItinerary, params.startDate, params.endDate));
      cacheHit = true;
      console.log(`[AI Generate] Using cached itinerary for ${params.destination}`);
    } else {
      // Cache miss - generate fresh itinerary
      console.log(`[AI Generate] Cache MISS for ${params.destination}, generating fresh...`);

      // Try Maps Grounding first (59% cost savings)
      // Falls back to traditional Gemini if Maps Grounding fails or is disabled
      if (USE_MAPS_GROUNDING && isMapsGroundingAvailable()) {
        try {
          console.log(`[AI Generate] Using Maps Grounding for ${params.destination}...`);
          itinerary = await generateItineraryWithMapsGrounding(params);
          usedMapsGrounding = true;
          console.log(`[AI Generate] Maps Grounding SUCCESS: ${itinerary.days.length} days, ${itinerary.days.reduce((sum, d) => sum + d.activities.length, 0)} activities`);
        } catch (mapsError) {
          console.error(`[AI Generate] Maps Grounding failed, falling back to Gemini:`, mapsError);
          // Fall through to traditional generation
          if (useIncremental) {
            console.log(`[AI Generate] Using incremental generation: first ${INITIAL_DAYS_TO_GENERATE} of ${totalDays} days`);
            itinerary = await generateItinerary(params, {
              maxDays: INITIAL_DAYS_TO_GENERATE,
              isPartial: true,
              language: userLanguage,
            });
            isPartialGeneration = true;
          } else {
            itinerary = await generateItinerary(params, { language: userLanguage });
          }
        }
      } else if (useIncremental) {
        // For long trips (>5 days), only generate the first 3 days initially
        console.log(`[AI Generate] Using incremental generation: first ${INITIAL_DAYS_TO_GENERATE} of ${totalDays} days`);
        itinerary = await generateItinerary(params, {
          maxDays: INITIAL_DAYS_TO_GENERATE,
          isPartial: true,
          language: userLanguage,
        });
        isPartialGeneration = true;
      } else {
        // For short trips, generate the full itinerary
        itinerary = await generateItinerary(params, { language: userLanguage });
      }

      // Only cache full itineraries (not partial ones)
      if (!isPartialGeneration) {
        await cacheItinerary(supabase, params.destination, params.vibes, params.budgetTier, userLanguage, itinerary);
      }

      // Populate activity bank in background for future activity additions
      // Use waitUntil to ensure background work completes on Vercel serverless
      // Try to get coordinates from the first activity that has them
      const firstActivityWithCoords = itinerary.days
        ?.flatMap(d => d.activities || [])
        ?.find(a => a.coordinates?.lat && a.coordinates?.lng);
      const destinationCoords: Coordinates | undefined = firstActivityWithCoords?.coordinates;

      // waitUntil keeps the function alive until the promise resolves
      // This ensures the activity bank population completes after response is sent
      waitUntil(
        (async () => {
          try {
            const populated = await isActivityBankPopulated(params.destination);
            if (!populated) {
              console.log(`[AI Generate] Populating activity bank for ${params.destination} in background...`);
              const result = await populateActivityBank(params.destination, destinationCoords);
              console.log(`[AI Generate] Activity bank populated: ${result.count} activities, cost: $${result.cost}`);
            }
          } catch (err) {
            console.error(`[AI Generate] Activity bank population error:`, err);
          }
        })()
      );
    }

    // Fetch activity images server-side (prevents race condition on client)
    // This ensures all activities have images before the response is sent
    if (!cacheHit) {
      try {
        await fetchActivityImages(itinerary.days, params.destination);
        console.log(`[AI Generate] Activity images fetched for ${itinerary.days.length} days`);
      } catch (imageError) {
        console.error("[AI Generate] Error fetching activity images:", imageError);
        // Continue without images - not critical
      }
    }

    // Sanitize AI-generated content to prevent XSS
    const sanitizedItinerary = sanitizeItinerary(itinerary);

    const generationTime = Date.now() - startTime;
    const generatedDays = sanitizedItinerary.days.length;
    const hasMoreDays = generatedDays < totalDays;

    // Calculate cost: Cache hit = $0, Maps Grounding = $0.025, Gemini partial = $0.002, Gemini full = $0.003
    const generationCost = cacheHit
      ? 0
      : usedMapsGrounding
        ? getMapsGroundingCost()
        : isPartialGeneration
          ? 0.002
          : 0.003;

    // Log the request using centralized gateway
    await logApiCall({
      apiName: usedMapsGrounding ? "maps_grounding" : "gemini",
      endpoint: "/api/ai/generate",
      status: 200,
      responseTimeMs: generationTime,
      cacheHit,
      costUsd: generationCost,
      metadata: {
        user_id: user?.id ?? "anonymous",
        is_anonymous: isAnonymous,
        destination: params.destination,
        vibes: params.vibes,
        duration: totalDays,
        generated_days: generatedDays,
        is_partial: isPartialGeneration,
        is_admin: userIsAdmin,
        used_maps_grounding: usedMapsGrounding,
      },
    });

    // Increment usage counters (only for non-cache hits — cache hits cost $0).
    let updatedUsage = usageCheck;
    if (!cacheHit) {
      if (user) {
        // Authenticated path: track usage in the per-user tier counter.
        // The early-access counters are no-ops now (see lib/early-access)
        // but kept in case a paywall ever lands.
        await incrementUsage(user.id, "aiGenerations", 1);
        await decrementFreeTrips(user.id);
        await incrementEarlyAccessUsage(user.id, "generation");

        updatedUsage = {
          ...usageCheck,
          used: usageCheck.used + 1,
          remaining: Math.max(0, usageCheck.remaining - 1),
        };
      } else {
        // Anonymous path: bump the cookie counter so the visitor can't
        // burn unlimited generations without ever signing up.
        await recordAnonymousGeneration();
      }
    }

    return apiSuccess({
      success: true,
      itinerary: sanitizedItinerary,
      meta: {
        generationTimeMs: generationTime,
        model: cacheHit ? "cache" : usedMapsGrounding ? "maps-grounding" : "gemini-2.5-flash-lite",
        cached: cacheHit,
        // Incremental generation metadata
        isPartial: isPartialGeneration,
        generatedDays,
        totalDays,
        hasMoreDays,
        nextStartDay: hasMoreDays ? generatedDays + 1 : null,
        remainingDays: hasMoreDays ? totalDays - generatedDays : 0,
        // Cost tracking
        costUsd: generationCost,
        usedMapsGrounding,
      },
      // Usage information for the client
      usage: updatedUsage,
    });
  } catch (error) {
    console.error("[AI Generate] Generation error:", error);

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

    return errors.internal("Failed to generate itinerary. Please try again.", "AI Generate");
  }
}
