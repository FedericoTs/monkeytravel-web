import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";
import { checkAnonymousRateLimit, recordAnonymousGeneration } from "@/lib/anonymous/rate-limit";
import type { User } from "@supabase/supabase-js";
import {
  generateItinerary,
  validateTripParams,
  shouldUseIncrementalGeneration,
  INITIAL_DAYS_TO_GENERATE,
  INCREMENTAL_GENERATION_THRESHOLD,
} from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";
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
import type { TripCreationParams, GeneratedItinerary } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import {
  getCachedItinerary,
  cacheItinerary,
  adjustItineraryDates,
} from "@/lib/ai/cache";
import { loadUserContext } from "@/lib/ai/user-context";
import { recordAiOutcome } from "@/lib/ai/observability";
import {
  generateMultiCityItinerary,
  validateLegs,
  type CityLeg,
} from "@/lib/ai/multi-city";

// Feature flag: Enable Maps Grounding for cost-effective generation
// Set USE_MAPS_GROUNDING=true in .env to enable (59% cost savings)
const USE_MAPS_GROUNDING = process.env.USE_MAPS_GROUNDING === "true";

// Cache helpers extracted to lib/ai/cache.ts (2026-05-28) so the
// streaming route can share them. See that file for the unique-key
// shape + idempotency guarantees.

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

    // PERF (#190): Fan out the independent pre-Gemini reads.
    //
    // Previously these ran serially:
    //   anon rate-limit → SELECT users(preferences,notification) →
    //     cookie read → SELECT users(preferred_language) →
    //     request.json → checkApiAccess
    //
    // None of them depend on each other (the request body parse is pure
    // I/O, and the users-table reads were a duplicate). Promise.all
    // collapses ~5 sequential RTTs into one parallel batch.
    //
    // Error semantics preserved: each member resolves to a result we
    // inspect in the original priority order below (anon rate-limit →
    // body validity → access kill-switch → quota). A rejection from
    // request.json is caught and surfaced as a 400.
    const [anonLimit, body, userContext, access] = await Promise.all([
      isAnonymous ? checkAnonymousRateLimit() : Promise.resolve(null),
      request.json().catch(() => null as Record<string, unknown> | null),
      loadUserContext(supabase, user?.id ?? null),
      checkApiAccess("gemini"),
    ]);

    if (isAnonymous && anonLimit && !anonLimit.allowed) {
      return errors.rateLimit(
        anonLimit.message || "Free trip limit reached. Sign up to keep generating.",
        { usage: anonLimit, signupUrl: "/auth/signup" }
      );
    }

    if (!body || typeof body !== "object") {
      return errors.badRequest("Body must be valid JSON");
    }

    const { profilePreferences, userLanguage } = userContext;
    console.log(`[AI Generate] User language: ${userLanguage} (anonymous=${isAnonymous})`);

    // Whitelist travelStyle so untrusted strings can't flow into the AI
    // system prompt. Anything other than "backpacker" → default "classic".
    const travelStyle: "classic" | "backpacker" =
      body.travelStyle === "backpacker" ? "backpacker" : "classic";

    const params: TripCreationParams = {
      destination: body.destination as string,
      startDate: body.startDate as string,
      endDate: body.endDate as string,
      budgetTier: (body.budgetTier as TripCreationParams["budgetTier"]) || "balanced",
      pace: (body.pace as TripCreationParams["pace"]) || "moderate",
      vibes: (body.vibes as TripCreationParams["vibes"]) || [],
      seasonalContext: body.seasonalContext as TripCreationParams["seasonalContext"],
      interests: (body.interests as string[]) || [],
      requirements: body.requirements as TripCreationParams["requirements"],
      travelStyle,
      // Include profile preferences (automatically fetched from user profile)
      profilePreferences,
    };

    // Validate input
    const validation = validateTripParams(params);
    if (!validation.valid) {
      return errors.badRequest(validation.error);
    }

    // Multi-city: when the client sends a `destinations` array of >1 leg, route
    // to the per-city PARALLEL generator (lib/ai/multi-city) instead of single-
    // city generation. Backward-compatible — requests without `destinations`
    // (the overwhelming majority) take the untouched single-city path below.
    // The client still sends destination/startDate/endDate (combined label +
    // whole-trip range) so usage limits, validation, and logging are unchanged.
    let legs: CityLeg[] | null = null;
    if (Array.isArray(body.destinations) && body.destinations.length > 0) {
      legs = (body.destinations as Array<{ city?: unknown; nights?: unknown }>).map((d) => ({
        city: String(d?.city ?? "").trim(),
        nights: Number(d?.nights),
      }));
    }
    const isMultiCity = legs !== null && legs.length > 1;
    if (isMultiCity) {
      try {
        validateLegs(legs!);
      } catch (e) {
        return errors.badRequest(e instanceof Error ? e.message : "Invalid destinations");
      }
    }

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
    //
    // PERF (#190): Run checkUsageLimit alongside the cross-user cache read.
    // They hit different tables (usage_limits vs activity_cache) and share
    // no state — running them sequentially was the single biggest avoidable
    // wait in the cache-hit path.

    // Calculate total trip duration (multi-city: the sum of per-city nights,
    // which is authoritative; single-city: derived from the date range).
    const totalDays = isMultiCity
      ? legs!.reduce((sum, l) => sum + l.nights, 0)
      : Math.ceil(
          (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1;

    // Determine if we should use incremental generation for long trips
    const useIncremental = shouldUseIncrementalGeneration(params.startDate, params.endDate);

    const userIsAdmin = user ? isAdmin(user.email) : false;

    // 2026-05-28 follow-up: the cache now keys on travel_style (Tier 1.2
    // migration), so backpacker hits its own cache pool — no leak into
    // classic results and vice versa. The skip-cache hack is removed.
    const [usageCheck, cachedItinerary] = await Promise.all([
      user
        ? checkUsageLimit(user.id, "aiGenerations", user.email)
        : Promise.resolve({
            allowed: true as const,
            used: 0,
            remaining: 999,
            limit: 999,
            message: undefined as string | undefined,
          }),
      getCachedItinerary(
        supabase,
        params.destination,
        params.vibes,
        params.budgetTier,
        userLanguage,
        params.travelStyle ?? "classic",
      ),
    ]);

    if (user && !usageCheck.allowed) {
      return errors.rateLimit(
        ("message" in usageCheck && usageCheck.message) || "Monthly trip generation limit reached.",
        { usage: usageCheck, upgradeUrl: "/pricing" }
      );
    }

    // Check cross-user cache first for same destination + vibes + budget
    // This can reduce AI costs by 40-60% for popular destinations
    let itinerary: GeneratedItinerary;
    let cacheHit = false;
    let isPartialGeneration = false;
    let usedMapsGrounding = false;

    if (isMultiCity) {
      // Multi-city: generate each city independently and in parallel, then
      // merge. Deliberately skips the cross-user cache, Maps Grounding, and
      // incremental generation — those are single-destination optimizations.
      // (Each per-city generation still hits generateItinerary's own dedup.)
      console.log(`[AI Generate] Multi-city generation: ${legs!.length} cities, ${totalDays} days`);
      itinerary = await generateMultiCityItinerary(params, legs!, params.startDate, {
        language: userLanguage,
      });
    } else if (cachedItinerary && cachedItinerary.days.length >= 1) {
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

      // Only cache full itineraries (not partial ones). Backpacker
      // results now have their own cache pool (Tier 1.2 migration
      // 2026-05-28), so the previous skip-cache hack is gone.
      if (!isPartialGeneration) {
        await cacheItinerary(
          supabase,
          params.destination,
          params.vibes,
          params.budgetTier,
          userLanguage,
          itinerary,
          params.travelStyle ?? "classic",
        );
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
    // Multi-city is generated whole (no incremental continuation), so never
    // advertise "more days" to fetch — that path is single-city only.
    const hasMoreDays = !isMultiCity && generatedDays < totalDays;

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

    // Fire-and-forget Sentry breadcrumb for the success rate dashboard.
    // The success-rate denominator needs both successes and failures, and
    // logApiCall above only writes to api_calls_log — Sentry would
    // otherwise only see failures, making the rate calc meaningless.
    void recordAiOutcome({
      endpoint: "generate",
      outcome: "success",
      model: cacheHit
        ? "cache"
        : usedMapsGrounding
          ? "maps-grounding"
          : getModelForPurpose("trip-generation"),
      cacheHit,
      durationMs: generationTime,
      userId: user?.id ?? null,
      metadata: {
        destination: params.destination,
        duration_days: totalDays,
        generated_days: generatedDays,
        is_partial: isPartialGeneration,
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
        model: cacheHit ? "cache" : usedMapsGrounding ? "maps-grounding" : getModelForPurpose("trip-generation"),
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

    // Capture to Sentry. Previously this only hit console + DB —
    // generation failures were invisible to alerting (task #223).
    void recordAiOutcome({
      endpoint: "generate",
      outcome: "failure",
      durationMs: Date.now() - startTime,
      error,
    });

    return errors.internal("Failed to generate itinerary. Please try again.", "AI Generate");
  }
}
