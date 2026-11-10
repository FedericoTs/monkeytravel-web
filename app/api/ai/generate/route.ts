import { deriveTimezoneFromItinerary } from "@/lib/trip/timezone";
import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { recordAnonymousGeneration, refundAnonymousGeneration } from "@/lib/anonymous/rate-limit";
import { generateItinerary } from "@/lib/gemini";
import { validateTripParams } from "@/lib/trips/request-validation";
import { MAX_TRIP_DAYS, MAX_TRIP_DAYS_MULTI } from "@/lib/trips/request-limits";
import { bookingLinksFor } from "@/lib/ai/server-fields";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import { isAdmin } from "@/lib/admin";
import { blockedCall, logApiCall } from "@/lib/api-gateway";
import { incrementUsage } from "@/lib/usage-limits";
import { isActivityBankPopulated, populateActivityBank } from "@/lib/activity-bank";
import { fetchActivityImages } from "@/lib/images/activity";
import { sanitizeItinerary } from "@/lib/utils/sanitize";
import type { TripCreationParams, GeneratedItinerary } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import { cacheItinerary, adjustItineraryDates } from "@/lib/ai/cache";
import { cachePolicy, mayCachePlan, servableCachedPlan } from "@/lib/ai/cache-policy";
import { generationQuotaReached, readGenerationPreflight } from "@/lib/ai/generation-preflight";
import { readGenerationCaller, tripParamsFromBody } from "@/lib/ai/generation-caller";
import { recordAiOutcome } from "@/lib/ai/observability";
import {
  generateMultiCityItinerary,
  validateLegs,
  type CityLeg,
} from "@/lib/ai/multi-city";
import { generateAnchoredItinerary, validateAnchors } from "@/lib/ai/anchored";
import { knownPlacesFor } from "@/lib/ai/known-places";
import { keepOffClosingDays } from "@/lib/ai/closing-days";
import { keepMustDos } from "@/lib/ai/must-dos";
import { inPlanCurrency } from "@/lib/ai/plan-currency";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import type { TripAnchor } from "@/types";
import { generationIdOf, generationOwner, keepGeneration } from "@/lib/ai/generation-result";
import { tripSpanDays } from "@/lib/dates/iso-date";
import { isModelOutOfCredit } from "@/lib/ai/model-outage";

// Cache helpers live in lib/ai/cache.ts, shared with the streaming route. See
// that file for the unique-key shape + idempotency guarantees.

export async function POST(request: NextRequest) {
  // Sums every Gemini response this request pays for: a multi-city trip makes
  // one call per city, and a retry is billed like the first attempt.
  const geminiCost = new GeminiCostMeter();
  return geminiCost.run(() => generate(request, geminiCost));
}

async function generate(request: NextRequest, geminiCost: GeminiCostMeter) {
  const startTime = Date.now();
  // The wizard's id for this request: the plan is kept under it, for a
  // browser that loses the answer (lib/ai/generation-result.ts).
  const generationId = generationIdOf(request);

  try {
    // Who is asking and with what body: an anonymous visitor over a cap, or a
    // body that is not JSON, is refused (lib/ai/generation-caller.ts).
    const caller = await readGenerationCaller(request, generationId);
    if ("refused" in caller) return caller.refused;
    const { supabase, user, isAnonymous, body, access, profilePreferences, userLanguage } = caller;
    console.log(`[AI Generate] User language: ${userLanguage} (anonymous=${isAnonymous})`);

    const params = tripParamsFromBody(body, profilePreferences);

    // "Try Different Version": the traveller gets a new plan, not the one on
    // screen (lib/ai/cache-policy).
    const wantsFresh = body.fresh === true;


    // Multi-city: a `destinations` array of >1 leg routes to the per-city
    // PARALLEL generator (lib/ai/multi-city); requests without it take the
    // single-city path below. The client still sends destination/startDate/
    // endDate (combined label + whole-trip range), which usage limits,
    // validation, and logging read.
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

    // Anchored trips (docs/CONSTRAINT_PLANNER_PLAN.md): fixed commitments the
    // plan must honour — a wedding, a flight, a night that must end in a
    // specific town. Not combinable with multi-city: the anchored planner
    // derives its own geography from the anchors themselves.
    if (Array.isArray(body.anchors) && body.anchors.length > 0) {
      if (isMultiCity) {
        return errors.badRequest("anchors cannot be combined with multi-city trips yet");
      }
      const anchors = body.anchors as TripAnchor[];
      try {
        validateAnchors(params.startDate, params.endDate, anchors);
      } catch (e) {
        return errors.badRequest(e instanceof Error ? e.message : "Invalid anchors");
      }
      params.anchors = anchors;
    }
    const isAnchored = Boolean(params.anchors && params.anchors.length > 0);

    // Validate input — the whole-trip date ceiling depends on the trip shape:
    // single-city stays at 14 days, multi-city may span up to 21 (per-city
    // parallel generation keeps each leg small).
    const validation = validateTripParams(params, { maxDays: isMultiCity ? MAX_TRIP_DAYS_MULTI : MAX_TRIP_DAYS });
    if (!validation.valid) {
      return errors.badRequest(validation.error);
    }

    if (!access.allowed) {
      return blockedCall(access, {
        apiName: "gemini",
        endpoint: "/api/ai/generate",
        startTime,
        metadata: { user_id: user?.id ?? "anonymous" },
        disabled: "AI generation is currently disabled",
      });
    }

    // Calculate total trip duration (multi-city: the sum of per-city nights,
    // which is authoritative; single-city: derived from the date range).
    const totalDays = isMultiCity
      ? legs!.reduce((sum, l) => sum + l.nights, 0)
      : tripSpanDays(params.startDate, params.endDate);

    const userIsAdmin = user ? isAdmin(user.email) : false;

    // Free users are NOT unlimited: the monthly cap answers 429 once it is used
    // up (anonymous visitors are capped above, by cookie and IP). The cache
    // keys on travel_style, so backpacker and classic trips never share a pool.
    const { usage: usageCheck, cached: cachedItinerary } =
      await readGenerationPreflight(user, params, userLanguage, totalDays);
    if (user && !usageCheck.allowed) {
      return generationQuotaReached(usageCheck);
    }
    const cacheRules = cachePolicy(params, wantsFresh, totalDays);
    const cacheHitPlan = servableCachedPlan(cachedItinerary, cacheRules);

    // Check cross-user cache first for same destination + vibes + budget
    let itinerary: GeneratedItinerary;
    let cacheHit = false;

    if (isMultiCity) {
      // Multi-city: generate each city independently and in parallel, then
      // merge. Deliberately skips the cross-user cache and
      // incremental generation — those are single-destination optimizations.
      // (Each per-city generation still hits generateItinerary's own dedup.)
      console.log(`[AI Generate] Multi-city generation: ${legs!.length} cities, ${totalDays} days`);
      itinerary = await generateMultiCityItinerary(params, legs!, params.startDate, {
        language: userLanguage,
      });
    } else if (isAnchored) {
      // Anchored: deterministic segmentation around the fixed commitments,
      // one small parallel generation per free gap, deterministic merge
      // (lib/ai/anchored). MUST come before the cross-user cache branch — a
      // cached generic itinerary would silently ignore the constraints.
      // Also skips incremental generation (segments are
      // small by construction). A fully locked trip makes ZERO model calls.
      console.log(
        `[AI Generate] Anchored generation: ${params.anchors!.length} anchors, ${totalDays} days`
      );
      const anchored = await generateAnchoredItinerary(
        params as TripCreationParams & { anchors: TripAnchor[] },
        { language: userLanguage }
      );
      itinerary = anchored.itinerary;
      if (anchored.issues.length > 0) {
        console.warn(`[AI Generate] anchored issues: ${anchored.issues.join(" | ")}`);
      }
    } else if (cacheHitPlan) {
      // Cache hit - adjust dates and sanitize (defense-in-depth: treat cached data as untrusted)
      // Booking links for this request's dates, not the cached plan's.
      itinerary = sanitizeItinerary({
        ...adjustItineraryDates(cacheHitPlan, params.startDate, params.endDate),
        booking_links: bookingLinksFor(params),
      });
      cacheHit = true;
      console.log(`[AI Generate] Using cached itinerary for ${params.destination}`);
    } else {
      // Cache miss - generate fresh itinerary
      console.log(`[AI Generate] Cache MISS for ${params.destination}, generating fresh...`);
      // Built first from the places travellers kept here, unless the traveller
      // asked for a plan unlike the last.
      const knownPlaces = wantsFresh ? [] : await knownPlacesFor(params, totalDays, userLanguage);

      itinerary = await generateItinerary(params, { language: userLanguage, knownPlaces });

      // Backpacker results have their own cache pool.
      if (mayCachePlan(itinerary, cachedItinerary, cacheRules)) {
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
        ?.find(a => isRealPoint(a.coordinates));
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

    // A must-do the plan holds nowhere gets one short question, and goes in
    // where it fits (lib/ai/must-dos.ts).
    const mustDosIn = await keepMustDos(itinerary, params.destination, params.mustDos, userLanguage);
    itinerary = mustDosIn.itinerary;

    // No stop on a day it's shut (lib/ai/closing-days.ts). A multi-city or
    // anchored trip keeps its order: its cities and commitments fix the days.
    if (!isMultiCity && !isAnchored) {
      itinerary = (await keepOffClosingDays(itinerary, params.destination)).itinerary;
    }

    // Assign activity images server-side (prevents a client race), cached
    // plans included: ZERO Google here. Every activity still gets an image — a
    // Wikimedia photo or a type-relevant stock image — so the pre-save result
    // page is never broken/empty. Real Google photos are resolved only for
    // SAVED trips (most generations never are), when their owner opens them,
    // via /api/trips/[id]/enrich-photos.
    try {
      await fetchActivityImages(itinerary.days, params.destination, { maxPaidLookups: 0, freePhotosOnly: true });
      console.log(`[AI Generate] Activity images assigned for ${itinerary.days.length} days (free only)`);
    } catch (imageError) {
      console.error("[AI Generate] Error fetching activity images:", imageError);
      // Continue without images - not critical
    }
    // Every price in one currency, a cached or grounded plan included.
    await inPlanCurrency(itinerary);

    // Sanitize AI-generated content to prevent XSS
    const sanitizedItinerary = sanitizeItinerary(itinerary);

    const generationTime = Date.now() - startTime;
    const generatedDays = sanitizedItinerary.days.length;

    // Cost: the Gemini tokens this request paid for (lib/ai/gemini-cost.ts). A
    // cache hit made no model call.
    const generationCost = cacheHit ? 0 : geminiCost.usd;

    // Log the request using centralized gateway
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/generate",
      status: 200,
      responseTimeMs: generationTime,
      cacheHit,
      costUsd: generationCost,
      exactCost: true,
      metadata: {
        user_id: user?.id ?? "anonymous",
        is_anonymous: isAnonymous,
        destination: params.destination,
        vibes: params.vibes,
        duration: totalDays,
        generated_days: generatedDays,
        is_admin: userIsAdmin,
        // "Try Different Version": a regenerate that skipped the cache.
        fresh: wantsFresh,
        ...(profilePreferences.dietaryPreferences?.length ? { dietary: profilePreferences.dietaryPreferences } : {}),
        // Must-dos the plan held nowhere, and how many of them went in.
        ...(mustDosIn.missing > 0 ? { must_dos: { missing: mustDosIn.missing, added: mustDosIn.added } } : {}),
        ...(generationId ? { generation_id: generationId } : {}),
      },
    });

    // Fire-and-forget Sentry breadcrumb for the success rate dashboard.
    // The success-rate denominator needs both successes and failures, and
    // logApiCall above only writes to api_request_logs — Sentry would
    // otherwise only see failures, making the rate calc meaningless.
    void recordAiOutcome({
      endpoint: "generate",
      outcome: "success",
      model: cacheHit ? "cache" : getModelForPurpose("trip-generation"),
      cacheHit,
      durationMs: generationTime,
      userId: user?.id ?? null,
      metadata: {
        destination: params.destination,
        duration_days: totalDays,
        generated_days: generatedDays,
      },
    });

    // Increment usage counters (only for non-cache hits — cache hits cost $0).
    let updatedUsage = usageCheck;
    if (!cacheHit) {
      if (user) {
        // Authenticated path: track usage in the per-user tier counter.
        await incrementUsage(user.id, "aiGenerations", 1);

        updatedUsage = {
          ...usageCheck,
          used: usageCheck.used + 1,
          remaining: Math.max(0, usageCheck.remaining - 1),
        };
      } else {
        // Anonymous path: bump the cookie counter so the visitor can't
        // burn unlimited generations without ever signing up. A try the
        // stream already counted is not counted again.
        await recordAnonymousGeneration(generationId ?? undefined);
      }
    }

    // The save arms read language into trip_meta.locale and timezone (derived
    // server-side from the itinerary coordinates) into trip_meta.timezone.
    const finishedItinerary = { ...sanitizedItinerary, language: userLanguage, timezone: deriveTimezoneFromItinerary(sanitizedItinerary.days) ?? undefined };
    const meta = {
      generationTimeMs: generationTime,
      model: cacheHit ? "cache" : getModelForPurpose("trip-generation"),
      cached: cacheHit,
      generatedDays,
      totalDays,
      // Cost tracking
      costUsd: generationCost,
    };
    // Kept before answering, so a browser that misses the answer finds it.
    if (generationId) {
      await keepGeneration(generationId, generationOwner(request), { itinerary: finishedItinerary, meta });
    }

    return apiSuccess({
      success: true,
      itinerary: finishedItinerary,
      meta,
      // Usage information for the client
      usage: updatedUsage,
    });
  } catch (error) {
    console.error("[AI Generate] Generation error:", error);

    // A try the stream counted before failing brought no plan, so it costs
    // nothing. Only this response can still change the cookie.
    if (generationId) await refundAnonymousGeneration(generationId).catch(() => {});

    // Log error using centralized gateway. Attempts the model answered before
    // the failure (a retried parse error) were billed all the same.
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/generate",
      status: 500,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: geminiCost.usd,
      exactCost: true,
      error: error instanceof Error ? error.message : "Unknown error",
      metadata: generationId ? { generation_id: generationId } : undefined,
    });

    // Capture to Sentry too: console + DB logs alone never alert.
    void recordAiOutcome({
      endpoint: "generate",
      outcome: "failure",
      durationMs: Date.now() - startTime,
      error,
    });

    if (isModelOutOfCredit(error)) return errors.modelOutage();
    return errors.internal("Failed to generate itinerary. Please try again.", "AI Generate");
  }
}
