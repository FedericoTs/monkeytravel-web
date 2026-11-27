import { deriveTimezoneFromItinerary } from "@/lib/trip/timezone";
import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { errors } from "@/lib/api/response-wrapper";
import { recordAnonymousGeneration } from "@/lib/anonymous/rate-limit";
import { generateItineraryStream } from "@/lib/gemini";
import { parseStreamedItinerary } from "@/lib/ai/itinerary-text";
import { slipNear } from "@/lib/ai/json-mend";
import { validateTripParams } from "@/lib/trips/request-validation";
import { bookingLinksFor, withActivityDefaults, withServerFields } from "@/lib/ai/server-fields";
import { inPlanCurrency } from "@/lib/ai/plan-currency";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { isAdmin } from "@/lib/admin";
import { logApiCall } from "@/lib/api-gateway";
import { isProbeSession } from "@/lib/analytics/telemetry-env";
import { incrementUsage } from "@/lib/usage-limits";
import { fetchActivityImages } from "@/lib/images/activity";
import { sanitizeItinerary } from "@/lib/utils/sanitize";
import { cacheItinerary, adjustItineraryDates } from "@/lib/ai/cache";
import { cachePolicy, mayCachePlan, servableCachedPlan } from "@/lib/ai/cache-policy";
import { generationQuotaReached, readGenerationPreflight } from "@/lib/ai/generation-preflight";
import { readGenerationCaller, tripParamsFromBody, withTypedPlace } from "@/lib/ai/generation-caller";
import type { GeneratedItinerary } from "@/types";
import {
  eventStreamFromGenerator,
  sseHeaders,
  type SseEvent,
} from "@/lib/streaming/sse";
import {
  createDayParser,
  feedChunk,
  finalize,
} from "@/lib/streaming/day-parser";
import { generateTripOutline } from "@/lib/ai/trip-outline";
import { PartsError, writeInParts, writesInParts } from "@/lib/ai/plan-in-parts";
import { generationIdOf, generationOwner, keepGeneration } from "@/lib/ai/generation-result";
import { knownPlacesFor, knownPlacesUsed, type KnownPlace } from "@/lib/ai/known-places";
import { keepOffClosingDays } from "@/lib/ai/closing-days";
import { planChecks } from "@/lib/ai/plan-checks";
import { keepInsideHours } from "@/lib/ai/visit-hours";
import { askForDinners, daysWithoutDinner, dinnersLeftTogether, placesToEat, withDinners } from "@/lib/ai/dinners";
import { atLocalDinnerHour, eatsEarly } from "@/lib/ai/meal-hours";
import { askForReplacements, repeatedRestaurants, withReplacements } from "@/lib/ai/repeated-meals";
import { askForSights, repeatedSights, sightNames, withSightReplacements } from "@/lib/ai/repeated-sights";
import { askForLunches, daysWithoutLunch, lunchesLeftTogether, withLunches } from "@/lib/ai/lunches";
import { swapClosedStops } from "@/lib/ai/closed-swaps";
import { withoutLongClosures } from "@/lib/ai/long-closures";
import { askedByName, keepMustDos } from "@/lib/ai/must-dos";
import { keepNamesInOneScript } from "@/lib/ai/one-script-names";
import { tripSpanDays } from "@/lib/dates/iso-date";
import { travelDaysFit } from "@/lib/ai/travel-days";
import { isModelOutOfCredit, MODEL_OUTAGE_MESSAGE } from "@/lib/ai/model-outage";

// Allow the function to run long enough for slow generations. Vercel
// Pro plan default is 60s; this bumps it. Hobby plan caps at 60 so this
// is a no-op there — the stream just terminates at 60s and the user
// sees a partial result.
export const maxDuration = 120;

/**
 * POST /api/ai/generate/stream
 *
 * Streaming counterpart to /api/ai/generate. Same request body, same
 * auth + rate-limit semantics — but the response is text/event-stream
 * with one SSE event per completed itinerary day, plus terminal
 * `complete` and `error` events.
 *
 * SSE event shape (see lib/streaming/sse.ts for full types):
 *   event: metadata
 *   data: {"destination":{...},"totalDays":7,"language":"en","mode":"stream"}
 *
 *   event: day
 *   data: {"day_number":1,"date":"2026-06-01","title":"...","activities":[...]}
 *   ... (one per day) ...
 *
 *   event: complete
 *   data: {"itinerary":{...full},"meta":{...},"usage":{...}}
 *
 *   event: error    (only on failure)
 *   data: {"error":"...","code":"upstream"}
 *
 * Cache-hit short-circuit: when the destination is already cached, we
 * skip streaming entirely and emit a single `complete` event with the
 * full cached itinerary (after a metadata event with mode=cache). The
 * client treats this case as "instant generation" — no progressive UI.
 *
 * This is purely additive — the existing non-streaming /api/ai/generate
 * is untouched, so JSON consumers (mobile cache warmer, future server-
 * side preview) keep working as before.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  // The wizard's id for this request: the plan is kept under it, for a
  // browser that loses the stream (lib/ai/generation-result.ts).
  const generationId = generationIdOf(request);
  // A live check's own plan (a tagged probe session) says so in every row it logs, so reads of travellers' plans
  // leave it out. The cookie is read here: inside the stream the request is no longer at hand.
  const probe = isProbeSession(request.cookies.get("mt_session_id")?.value);
  const log = (row: Parameters<typeof logApiCall>[0]) => logApiCall(probe ? { ...row, metadata: { ...row.metadata, probe: true } } : row);

  // 1. Pre-flight: parse body and run all checks BEFORE opening the SSE
  //    stream. Failures here can return JSON 4xx/5xx normally (better
  //    DX for the client than an SSE error event). Who is asking and with
  //    what body: lib/ai/generation-caller.ts.
  const caller = await readGenerationCaller(request, generationId);
  if ("refused" in caller) return caller.refused;
  const { supabase, user, isAnonymous, body, access, profilePreferences, userLanguage } = caller;
  // A place typed and not picked gets its point from the cities table.
  const params = await withTypedPlace(tripParamsFromBody(body, profilePreferences), body);

  // "Try Different Version" (the wizard's Regenerate) asks for a NEW plan, not
  // the one on screen (lib/ai/cache-policy).
  const wantsFresh = body.fresh === true;

  const validation = validateTripParams(params);
  if (!validation.valid) {
    return errors.badRequest(validation.error);
  }

  // API access kill-switch (Gemini circuit breaker) — already resolved
  // above in the Promise.all batch.
  if (!access.allowed) {
    return errors.serviceUnavailable(
      access.message || "AI generation is currently disabled"
    );
  }

  // The quota and the cross-user cache are read before the stream starts:
  // that delays its first byte, but a cache hit skips the model call.
  const userIsAdmin = user ? isAdmin(user.email) : false;
  const totalDays = tripSpanDays(params.startDate, params.endDate);
  // Places travellers kept here, read alongside the cache and used only when a
  // plan is written. "Try Different Version" asks for a plan unlike the last.
  const knownPlacesRead = wantsFresh ? Promise.resolve([]) : knownPlacesFor(params, totalDays, userLanguage);
  const { usage: usageCheck, cached: preflightCachedItinerary } =
    await readGenerationPreflight(user, params, userLanguage, totalDays);
  if (user && !usageCheck.allowed) {
    return generationQuotaReached(usageCheck);
  }
  const cacheRules = cachePolicy(params, wantsFresh, totalDays);
  const cacheHitPlan = servableCachedPlan(preflightCachedItinerary, cacheRules);

  // 2. The actual generator — yields SSE events. Cache-hit branch returns
  //    a single `complete` event; cache-miss branch streams days.
  const sseGenerator = async function* (): AsyncGenerator<SseEvent, void, unknown> {
    let generatedDays = 0;
    // When the planner could show day 1 of a fresh plan.
    let firstDayMs: number | null = null;
    let cacheHit = false;
    let finalItinerary: GeneratedItinerary | null = null;
    // What the model call cost, from its token counts (set once it answers).
    let generationCost = 0;
    // A long trip written in parts (lib/ai/plan-in-parts.ts): how many, how
    // many were written twice, and when its outline was on screen.
    let parts = 0;
    let partRetries = 0;
    let outlineMs: number | null = null;
    let knownPlaces: KnownPlace[] = [];

    try {
      // 3a. Cache short-circuit: backpacker and classic each have their
      //     own cache pool, read in the preflight above.
      if (cacheHitPlan) {
        const adjusted = adjustItineraryDates(
          cacheHitPlan,
          params.startDate,
          params.endDate,
        );
        // Booking links for this request's dates, not the cached plan's.
        finalItinerary = sanitizeItinerary({ ...adjusted, booking_links: bookingLinksFor(params) });
        cacheHit = true;
        // A cached plan's photos are those of when it was cached, Google's
        // among them: the preview shows free ones only, before any day goes out.
        try {
          await fetchActivityImages(finalItinerary.days, params.destination, { maxPaidLookups: 0, freePhotosOnly: true });
        } catch (imgErr) {
          console.error("[AI Generate Stream] image fetch error:", imgErr);
        }

        // Metadata first — flag mode=cache so the client knows we
        // didn't actually stream.
        yield {
          type: "metadata",
          data: {
            destination: finalItinerary.destination,
            totalDays: finalItinerary.days.length,
            language: userLanguage,
            mode: "cache",
          },
        };

        // Emit each day in order, same shape as the streaming path,
        // so the existing client UI lights up day-by-day with no code
        // change. Their images were assigned above; step 6 skips them.
        for (const day of finalItinerary.days) {
          generatedDays++;
          yield {
            type: "day",
            data: day as unknown as import("@/lib/streaming/sse").SseDayData,
          };
        }
        // Fall through to step 6+ (image-skip + logging + complete event)
      }

      if (!cacheHit) {
        // Metadata event — always first when streaming, so the client
        // knows total days + destination for the progress UI.
        yield {
          type: "metadata",
          data: {
            destination: { name: params.destination, country: "" },
            totalDays,
            language: userLanguage,
            mode: "stream",
          },
        };

      knownPlaces = await knownPlacesRead;

      // 3b. A long trip: an outline first, on screen at once, then the days
      //     written in parts at the same time. Without an outline the trip
      //     is written in one stream below.
      const outline = writesInParts(totalDays)
        ? await generateTripOutline(params, totalDays, userLanguage, knownPlaces)
        : null;
      if (outline) {
        generationCost += outline.costUsd;
        outlineMs = Date.now() - startTime;
        yield { type: "outline", data: { days: outline.days } };
        try {
          for await (const out of writeInParts(params, totalDays, outline.days, {
            language: userLanguage,
            userId: user?.id,
          })) {
            if (out.type === "day") {
              generatedDays++;
              firstDayMs ??= Date.now() - startTime;
              yield { type: "day", data: out.day as unknown as import("@/lib/streaming/sse").SseDayData };
            } else {
              finalItinerary = out.itinerary;
              generationCost += out.costUsd;
              parts = out.parts;
              partRetries = out.retries;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          waitUntil(
            log({
              apiName: "gemini",
              endpoint: "/api/ai/generate/stream",
              status: 500,
              responseTimeMs: Date.now() - startTime,
              cacheHit: false,
              costUsd: generationCost + (err instanceof PartsError ? err.costUsd : 0),
              exactCost: true,
              error: `parts failed: ${msg}`,
              metadata: { user_id: user?.id ?? "anonymous", ...(generationId ? { generation_id: generationId } : {}) },
            }).catch(() => undefined)
          );
          yield { type: "error", data: { error: `Generation failed: ${msg}`, code: "upstream" } };
          return;
        }
      } else {
      // 3c. Stream the model when there's no cached entry to serve.
      const parser = createDayParser();
      const stream = generateItineraryStream(params, {
        language: userLanguage,
        userId: user?.id,
        knownPlaces,
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (chunk.done) {
          fullText = chunk.fullText;
          generationCost = geminiCostUsd(
            getModelForPurpose("trip-generation"),
            chunk.usageMetadata
          );
          break;
        }
        const newDays = feedChunk(parser, chunk.text);
        for (const day of newDays) {
          generatedDays++;
          firstDayMs ??= Date.now() - startTime;
          // The parser guarantees a day-shaped object (day_number + date)
          // because we only enter the days array branch after `"days":[`
          // — anything else fails the parse and we fall back below.
          yield { type: "day", data: withActivityDefaults(day) as unknown as import("@/lib/streaming/sse").SseDayData };
        }
      }

      // 4. Final parse for canonical truth. The streaming parser may have
      //    missed days (defensive) — the full-text parse is authoritative.
      try {
        finalItinerary = parseStreamedItinerary(fullText, params);
      } catch (err) {
        // Try the parser's accumulated buffer as a last-ditch rescue.
        const rescued = finalize(parser);
        if (rescued && typeof rescued === "object") {
          finalItinerary = withServerFields(rescued as GeneratedItinerary, params);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          // The model answered, so Google billed it: log the failure and
          // its cost (this return used to skip logging altogether).
          waitUntil(
            log({
              apiName: "gemini",
              endpoint: "/api/ai/generate/stream",
              status: 500,
              responseTimeMs: Date.now() - startTime,
              cacheHit: false,
              costUsd: generationCost,
              exactCost: true,
              error: `unparseable output: ${msg}`,
              metadata: {
                user_id: user?.id ?? "anonymous",
                ...(generationId ? { generation_id: generationId } : {}),
                // The text around the slip that couldn't be mended: the next one to teach lib/ai/json-mend.ts.
                ...(slipNear(err) ? { slip: slipNear(err) } : {}),
              },
            }).catch(() => undefined)
          );
          yield {
            type: "error",
            data: {
              error: `Generation produced unparseable output: ${msg}`,
              code: "upstream",
            },
          };
          return;
        }
      }

      // 5. If progressive parser missed any days, backfill them via the
      //    final parse before the complete event so the client doesn't
      //    show partial state.
      if (finalItinerary.days.length > generatedDays) {
        for (let i = generatedDays; i < finalItinerary.days.length; i++) {
          yield {
            type: "day",
            data: finalItinerary.days[i] as unknown as import("@/lib/streaming/sse").SseDayData,
          };
        }
        generatedDays = finalItinerary.days.length;
      }
      } // end one stream
      } // end if (!cacheHit) — streaming branch closes here

      // 6. Server-side image fetch. Same as the non-streaming path —
      //    prevents a race condition on the client. Skipped on cache hit
      //    (cached entries already have images).
      // finalItinerary is guaranteed non-null here: either the cache
      // branch set it, or the streaming branch parsed/rescued it.
      if (!finalItinerary) {
        // Defensive — should be unreachable, but TypeScript can't see the
        // mutual exclusivity above. Emit error and bail.
        yield {
          type: "error",
          data: { error: "Generation produced no itinerary", code: "upstream" },
        };
        return;
      }
      // 5a. A must-do the plan holds nowhere gets one short question, and goes
      //     in where it fits (lib/ai/must-dos.ts).
      const mustDosIn = await keepMustDos(finalItinerary, params.destination, params.mustDos, userLanguage);
      finalItinerary = mustDosIn.itinerary;
      generationCost += mustDosIn.costUsd;
      // 5a'. A name with two writing systems in one word ("Green波
      //      Restaurant") gets its usual name (lib/ai/one-script-names.ts).
      const namesIn = await keepNamesInOneScript(finalItinerary, params.destination, userLanguage);
      finalItinerary = namesIn.itinerary;
      generationCost += namesIn.costUsd;
      // 5a''. No stop at a place shut for the whole trip (lib/ai/long-closures.ts),
      //       a cached plan's or a must-do's included.
      const longClosed = withoutLongClosures(finalItinerary, params);
      finalItinerary = longClosed.itinerary;
      // 5b. No stop on a day it's shut: the plan's sights are asked about,
      //     and its days ordered around their closing days. A cached plan has
      //     new dates, so it too (lib/ai/closing-days.ts). One shut on every
      //     date it could go to is swapped for an open place (lib/ai/closed-swaps.ts).
      //     A full day the plan left without dinner gets one, asked for meanwhile
      //     so the plan isn't slower (lib/ai/dinners.ts).
      const dinnersWanted = daysWithoutDinner(finalItinerary.days, params.destination, eatsEarly(params));
      const mealOptions = {
        budgetTier: params.budgetTier,
        diets: profilePreferences.dietaryPreferences,
        language: userLanguage,
        taken: placesToEat(finalItinerary.days),
      };
      const dinnersAsked = askForDinners(dinnersWanted, mealOptions);
      //     A restaurant named again on a later day gets another, asked
      //     for meanwhile too (lib/ai/repeated-meals.ts).
      const repeatsWanted = repeatedRestaurants(finalItinerary.days, params.destination);
      const repeatsAsked = askForReplacements(repeatsWanted, mealOptions);
      //     A sight visited again on another day gets another of its kind,
      //     asked for meanwhile too (lib/ai/repeated-sights.ts).
      const sightsWanted = repeatedSights(finalItinerary.days, params.destination, askedByName(params.mustDos));
      const sightsAsked = askForSights(sightsWanted, { language: userLanguage, taken: sightNames(finalItinerary.days) });
      //     A full day left without lunch gets one after a visit of it,
      //     asked for meanwhile too (lib/ai/lunches.ts).
      const lunchesWanted = daysWithoutLunch(finalItinerary.days, params.destination);
      const lunchesAsked = askForLunches(lunchesWanted, mealOptions);
      const openDays = await keepOffClosingDays(
        finalItinerary,
        params.destination,
        undefined,
        undefined,
        (days, stuck) => swapClosedStops(params.destination, days, stuck, userLanguage),
        undefined,
        // A must-do keeps a day it is open before a sight nobody asked for does.
        askedByName(params.mustDos)
      );
      finalItinerary = openDays.itinerary;
      generationCost += openDays.costUsd;
      //     The days can have moved: a first or last day, planned without lunch or dinner, now in
      //     the middle of the trip. Its lunch and dinner are asked for now, together; nothing is
      //     asked when none moved.
      const movedDinnersWanted = daysWithoutDinner(finalItinerary.days, params.destination, eatsEarly(params)).filter(
        (day) => !dinnersWanted.some((asked) => asked.after === day.after)
      );
      const movedDinnersAsked = askForDinners(movedDinnersWanted, mealOptions);
      const movedLunchesWanted = daysWithoutLunch(finalItinerary.days, params.destination).filter(
        (day) => !lunchesWanted.some((asked) => asked.after === day.after)
      );
      const movedLunchesAsked = askForLunches(movedLunchesWanted, mealOptions);
      //     The lunches, after the visits they were chosen near, wherever those
      //     now are: before the hours step, which then sees the day's times.
      const lunchAnswer = await lunchesAsked;
      const lunches = withLunches(finalItinerary.days, lunchesWanted, lunchAnswer.answer);
      const movedLunchAnswer = await movedLunchesAsked;
      const movedLunches = withLunches(lunches.days, movedLunchesWanted, movedLunchAnswer.answer);
      const lunchesLeft = lunchesLeftTogether(lunches.left, movedLunches.left);
      finalItinerary = { ...finalItinerary, days: movedLunches.days };
      generationCost += lunchAnswer.costUsd + movedLunchAnswer.costUsd;
      // 5b'. Each visit to a place of known hours inside them: a garden that
      //      shuts at four isn't planned from half past two to half past four
      //      (lib/ai/visit-hours.ts).
      const inHours = keepInsideHours(finalItinerary.days, params.destination);
      finalItinerary = { ...finalItinerary, days: inHours.days };
      // 5b''. The dinners, after the places they were chosen near, wherever those now are.
      const dinnerAnswer = await dinnersAsked;
      const dinners = withDinners(finalItinerary.days, dinnersWanted, dinnerAnswer.answer);
      const movedDinnerAnswer = await movedDinnersAsked;
      const movedDinners = withDinners(dinners.days, movedDinnersWanted, movedDinnerAnswer.answer);
      const dinnersLeft = dinnersLeftTogether(dinners.left, movedDinners.left);
      finalItinerary = { ...finalItinerary, days: movedDinners.days };
      generationCost += dinnerAnswer.costUsd + movedDinnerAnswer.costUsd;
      // 5b'''. Then each repeated restaurant's replacement, in its place.
      const repeatAnswer = await repeatsAsked;
      const repeats = withReplacements(finalItinerary.days, repeatsWanted, repeatAnswer.answer);
      finalItinerary = { ...finalItinerary, days: repeats.days };
      generationCost += repeatAnswer.costUsd;
      // 5b''''. And each repeated sight's replacement, in its place.
      const sightAnswer = await sightsAsked;
      const sights = withSightReplacements(finalItinerary.days, sightsWanted, sightAnswer.answer);
      finalItinerary = { ...finalItinerary, days: sights.days };
      // 5b'''''. The plan's own last dinner of a day at the local hour (lib/ai/meal-hours.ts): 19:30 in Cádiz is 20:30.
      const atHour = atLocalDinnerHour(finalItinerary.days, eatsEarly(params));
      finalItinerary = { ...finalItinerary, days: atHour.days };
      generationCost += sightAnswer.costUsd;
      if (!cacheHit) {
        try {
          // Zero Google at generation: Wikimedia photos and type-relevant stock
          // images only, so the preview of a plan nobody keeps costs nothing.
          // Real photos resolve when a saved trip is opened
          // (/api/trips/[id]/enrich-photos), only for trips that are kept.
          await fetchActivityImages(finalItinerary.days, params.destination, { maxPaidLookups: 0, freePhotosOnly: true });
        } catch (imgErr) {
          console.error("[AI Generate Stream] image fetch error:", imgErr);
        }
      }
      // 5c. Every price in one currency, a plan written in parts or cached included.
      finalItinerary = await inPlanCurrency(finalItinerary);

      // 6b. Cache write — only when we actually generated fresh.
      // Backpacker + classic each have their own cache pool (Tier 1.2
      // migration). Fire-and-forget via waitUntil so it never blocks
      // the complete event.
      if (!cacheHit && mayCachePlan(finalItinerary, preflightCachedItinerary, cacheRules)) {
        const cacheWriteItinerary = finalItinerary;
        waitUntil(
          cacheItinerary(
            supabase,
            params.destination,
            params.vibes,
            params.budgetTier,
            userLanguage,
            cacheWriteItinerary,
            params.travelStyle ?? "classic",
          ).catch((err) => {
            console.error("[AI Generate Stream] cache write failed:", err);
          }),
        );
      }

      // 7. Sanitize before sending the canonical itinerary in `complete`.
      const sanitized = sanitizeItinerary(finalItinerary);

      const generationTimeMs = Date.now() - startTime;

      // 8. Log + increment counters — happens in waitUntil so the stream
      //    completes for the client even if logging is slow.
      waitUntil(
        (async () => {
          try {
            await log({
              apiName: "gemini",
              endpoint: "/api/ai/generate/stream",
              status: 200,
              responseTimeMs: generationTimeMs,
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
                streamed: true,
                // "Try Different Version": a regenerate that skipped the cache.
                fresh: wantsFresh,
                ...(profilePreferences.dietaryPreferences?.length ? { dietary: profilePreferences.dietaryPreferences } : {}),
                ...(firstDayMs !== null ? { first_day_ms: firstDayMs } : {}),
                ...(parts > 0 ? { parts, outline_ms: outlineMs } : {}),
                ...(partRetries > 0 ? { part_retries: partRetries } : {}),
                ...(knownPlaces.length > 0
                  ? { known_places: knownPlaces.length, known_places_used: knownPlacesUsed(sanitized.days, knownPlaces) }
                  : {}),
                // Must-dos the plan held nowhere, and how many of them went in.
                ...(mustDosIn.missing > 0 ? { must_dos: { missing: mustDosIn.missing, added: mustDosIn.added } } : {}),
                // When they arrive and leave, and the stops planned before they're there or after they've gone.
                ...(params.arrival || params.departure ? { travel_days: travelDaysFit(sanitized.days, params) } : {}),
                ...(namesIn.glued > 0 ? { names: { glued: namesIn.glued, renamed: namesIn.renamed } } : {}),
                ...(longClosed.removed > 0 ? { long_closures_removed: longClosed.removed } : {}),
                // Stops on a day they're shut, before and after the days were ordered, and stops moved on their own.
                ...(openDays.asked > 0 || openDays.known > 0
                  ? {
                      closing_days: {
                        asked: openDays.asked,
                        known: openDays.known,
                        shut_before: openDays.shutBefore,
                        shut_listed: openDays.shutListed,
                        // Stops shut on their day for the season alone (lib/ai/seasonal-closings.ts).
                        ...(openDays.seasonal > 0 ? { seasonal: openDays.seasonal } : {}),
                        shut_after: openDays.shutAfter,
                        stops_moved: openDays.stopsMoved,
                        swapped: openDays.swapped,
                        // Which stops were left on a day they're shut: a miss says what it was.
                        ...(openDays.leftShut.length > 0 ? { left: openDays.leftShut.slice(0, 5) } : {}),
                      },
                    }
                  : {}),
                // Visits to places of known hours: how many were outside them, and what was done.
                ...(inHours.checked > 0
                  ? {
                      visit_hours: {
                        checked: inHours.checked,
                        outside: inHours.outside,
                        moved: inHours.moved,
                        shortened: inHours.shortened,
                        ...(inHours.left.length > 0 ? { left: inHours.left.slice(0, 5) } : {}),
                      },
                    }
                  : {}),
                // Full days the plan left without dinner, and how many got one; after_move: those found only once
                // the closing days had moved the days.
                ...(dinnersWanted.length + movedDinnersWanted.length > 0
                  ? {
                      dinners: {
                        missing: dinnersWanted.length + movedDinnersWanted.length,
                        added: dinners.added + movedDinners.added,
                        ...(movedDinnersWanted.length > 0 ? { after_move: movedDinnersWanted.length } : {}),
                        // Why the days still without one have none (lib/ai/dinners.ts DinnerLeftOut).
                        ...(Object.keys(dinnersLeft).length > 0 ? { left: dinnersLeft } : {}),
                      },
                    }
                  : {}),
                // The plan's own dinners moved to the local hour.
                ...(atHour.moved > 0 ? { dinners_at_hour: atHour.moved } : {}),
                // Full days the plan left without lunch, and how many got one; after_move: those found only
                // once the closing days had moved the days.
                ...(lunchesWanted.length + movedLunchesWanted.length > 0
                  ? {
                      lunches: {
                        missing: lunchesWanted.length + movedLunchesWanted.length,
                        added: lunches.added + movedLunches.added,
                        ...(movedLunchesWanted.length > 0 ? { after_move: movedLunchesWanted.length } : {}),
                        // Why the days still without one have none (lib/ai/lunches.ts LunchLeftOut).
                        ...(Object.keys(lunchesLeft).length > 0 ? { left: lunchesLeft } : {}),
                      },
                    }
                  : {}),
                ...(repeatsWanted.length > 0 ? { repeated_restaurants: { found: repeatsWanted.length, replaced: repeats.replaced } } : {}),
                ...(sightsWanted.length > 0 ? { repeated_sights: { found: sightsWanted.length, replaced: sights.replaced } } : {}),
                ...(generationId ? { generation_id: generationId } : {}),
              },
            });
            // Anonymous generations are counted before the stream starts
            // (9b): once it is under way a cookie can no longer be set.
            if (!cacheHit && user) {
              await incrementUsage(user.id, "aiGenerations", 1);
            }
          } catch (err) {
            console.error("[AI Generate Stream] post-stream cleanup error:", err);
          }
        })()
      );

      // 9. Terminal complete event.
      // Phase 1.3: the save arms read this into trip_meta.locale.
      // Phase 1.3 language + Phase 3.1 timezone (derived server-side).
      // What the closing-day check found, for the plan to say to its reader.
      const checked = planChecks(openDays);
      const completeItinerary = {
        ...sanitized,
        language: userLanguage,
        timezone: deriveTimezoneFromItinerary(sanitized.days) ?? undefined,
        ...(checked ? { checked } : {}),
      };
      const completeMeta = {
        generationTimeMs,
        model: cacheHit ? "cache" : getModelForPurpose("trip-generation"),
        cached: cacheHit,
        generatedDays,
        totalDays,
        costUsd: generationCost,
      };
      // Kept before the event goes out, so a browser that misses it finds it.
      if (generationId) {
        await keepGeneration(generationId, generationOwner(request), { itinerary: completeItinerary, meta: completeMeta });
      }
      yield {
        type: "complete",
        data: {
          itinerary: completeItinerary,
          meta: completeMeta,
          usage: user
            ? { ...usageCheck, used: usageCheck.used + 1 }
            : undefined,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      console.error("[AI Generate Stream] fatal error:", msg);
      // Best-effort log — don't block the error event.
      waitUntil(
        log({
          apiName: "gemini",
          endpoint: "/api/ai/generate/stream",
          status: 500,
          responseTimeMs: Date.now() - startTime,
          cacheHit: false,
          costUsd: generationCost,
          exactCost: true,
          error: msg,
          metadata: { user_id: user?.id ?? "anonymous", ...(generationId ? { generation_id: generationId } : {}) },
        }).catch(() => undefined)
      );
      // Sanitize the SSE error payload — the raw Gemini SDK message
      // can leak the upstream URL, the model ID, and credential-state
      // strings like "API key was reported as leaked". The non-stream
      // sibling at /api/ai/generate already returns the generic
      // "Failed to generate itinerary. Please try again." via
      // errors.internal(); mirror that here. The raw `msg` is still
      // captured server-side via console.error + logApiCall above for
      // ops visibility — only the client view is scrubbed. Keep
      // `code: "upstream"` so the wizard can distinguish upstream
      // failures from other SSE error types.
      yield {
        type: "error",
        data: {
          error: isModelOutOfCredit(err) ? MODEL_OUTAGE_MESSAGE : "Generation failed. Please try again.",
          code: "upstream",
        },
      };
    }
  };

  // 9b. Count an anonymous generation NOW, while the response headers can
  //     still carry the cookie. recordAnonymousGeneration() sets mt_anon
  //     through cookies(), which only works before the headers are sent:
  //     after the stream the cookie would never reach the browser and the
  //     5-a-day anonymous cap would never apply. Cache hits stay free. When
  //     the stream fails, the JSON endpoint the wizard falls back to, whose
  //     response can still set the cookie, settles the count under this id.
  if (isAnonymous && !cacheHitPlan) {
    await recordAnonymousGeneration(generationId ?? undefined);
  }

  // 10. Build the SSE response.
  const stream = eventStreamFromGenerator(sseGenerator());
  return new Response(stream, {
    status: 200,
    headers: sseHeaders(),
  });
}
