import { deriveTimezoneFromItinerary } from "@/lib/trip/timezone";
import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { errors } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  checkAnonymousRateLimit,
  recordAnonymousGeneration,
} from "@/lib/anonymous/rate-limit";
import type { User } from "@supabase/supabase-js";
import {
  generateItineraryStream,
  parseStreamedItinerary,
  validateTripParams,
} from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { isAdmin } from "@/lib/admin";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { fetchActivityImages } from "@/lib/images/activity";
import { sanitizeItinerary } from "@/lib/utils/sanitize";
import {
  getCachedItinerary,
  cacheItinerary,
  adjustItineraryDates,
} from "@/lib/ai/cache";
import { loadUserContext } from "@/lib/ai/user-context";
import { requestLocale } from "@/lib/ai/language";
import type {
  TripCreationParams,
  GeneratedItinerary,
} from "@/types";
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
import { createRateLimiter } from "@/lib/api/rate-limit";
import { generateTripOutline } from "@/lib/ai/trip-outline";
import { PartsError, writeInParts, writesInParts } from "@/lib/ai/plan-in-parts";
import { generationIdOf, generationOwner, keepGeneration } from "@/lib/ai/generation-result";

// Allow the function to run long enough for slow generations. Vercel
// Pro plan default is 60s; this bumps it. Hobby plan caps at 60 so this
// is a no-op there — the stream just terminates at 60s and the user
// sees a partial result.
export const maxDuration = 120;

// Anti-abuse: cap ANONYMOUS generations per IP/day. Shared "anon-generate"
// namespace with the non-stream route so both count against one bucket. HIGH
// limit (40/IP/day) + fail-open so it can never throttle a real user or shared
// NAT at current scale — only a cookie-resetting scripted attacker doing
// hundreds/day. Authenticated users are never limited.
const anonGenIpLimiter = createRateLimiter("anon-generate", 40, 24 * 60 * 60 * 1000);

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

  // 1. Pre-flight: parse body and run all checks BEFORE opening the SSE
  //    stream. Failures here can return JSON 4xx/5xx normally (better
  //    DX for the client than an SSE error event).
  const supabase = await createClient();
  const {
    data: { user: maybeUser },
  } = await supabase.auth.getUser();
  const user: User | null = maybeUser ?? null;
  const isAnonymous = user === null;

  // PERF (#190): Fan out the independent pre-flight reads. None of these
  // depend on each other:
  //   - anon rate-limit reads a cookie
  //   - request.json is pure I/O
  //   - loadUserContext does ONE consolidated SELECT (preferences +
  //     notification_settings + preferred_language) + cookie read in
  //     parallel — replaces TWO duplicate user-table SELECTs in the
  //     previous serial path
  //   - checkApiAccess('gemini') is a kill-switch table read
  //
  // Each member resolves to a value we inspect in the original priority
  // order so error semantics are preserved (anon limit → bad body →
  // access denied → quota).
  const [anonLimit, parsedBody, userContext, access, anonIpLimit] = await Promise.all([
    isAnonymous ? checkAnonymousRateLimit() : Promise.resolve(null),
    request
      .json()
      .then((b) => b as Record<string, unknown>)
      .catch(() => null as Record<string, unknown> | null),
    loadUserContext(supabase, user?.id ?? null),
    checkApiAccess("gemini"),
    // Per-IP anon backstop. Fail-OPEN: a limiter/KV error must NEVER block a
    // real generation, so swallow errors into an allow.
    isAnonymous
      ? anonGenIpLimiter.check(request).catch(() => ({ allowed: true, remaining: 0 }))
      : Promise.resolve(null),
  ]);

  if (isAnonymous && anonLimit && !anonLimit.allowed) {
    return errors.rateLimit(
      anonLimit.message ||
        "Free trip limit reached. Sign up to keep generating.",
      { usage: anonLimit, signupUrl: "/auth/signup" }
    );
  }

  // Per-IP backstop for cookie-resetting bots (the cookie cap above is
  // trivially reset). Only trips under real abuse at 40/IP/day.
  if (isAnonymous && anonIpLimit && !anonIpLimit.allowed) {
    return errors.rateLimit(
      "You've reached today's free-trip limit for your network. Sign up to keep generating — it's free.",
      { signupUrl: "/auth/signup" }
    );
  }

  if (!parsedBody) {
    return errors.badRequest("Body must be valid JSON");
  }
  const body = parsedBody;

  const { profilePreferences } = userContext;
  // The page's own locale wins: next-intl writes NEXT_LOCALE only when it
  // differs from the browser language, so the cookie is usually absent.
  const userLanguage = requestLocale(body.locale) ?? userContext.userLanguage;

  const params: TripCreationParams = {
    destination: body.destination as string,
    startDate: body.startDate as string,
    endDate: body.endDate as string,
    // Casts here mirror the non-streaming route's loose body-parsing —
    // validateTripParams below rejects unknown enum values, so trusting
    // the cast is safe; the validator is the actual security boundary.
    budgetTier: ((body.budgetTier as TripCreationParams["budgetTier"]) ||
      "balanced") as TripCreationParams["budgetTier"],
    pace: ((body.pace as TripCreationParams["pace"]) ||
      "moderate") as TripCreationParams["pace"],
    vibes: (body.vibes as TripCreationParams["vibes"]) || [],
    seasonalContext: body.seasonalContext as TripCreationParams["seasonalContext"],
    interests: (body.interests as string[]) || [],
    requirements: body.requirements as TripCreationParams["requirements"],
    // Must-do wishlist (P3a) — mirrors the non-streaming route; the
    // validator below enforces count/length/injection limits.
    ...(Array.isArray(body.mustDos) && body.mustDos.length > 0
      ? {
          mustDos: (body.mustDos as unknown[])
            .map((m) => String(m ?? "").trim())
            .filter(Boolean)
            .slice(0, 10),
        }
      : {}),
    // Whitelist travelStyle (same pattern as the non-streaming route).
    // Untrusted input can't flow into the AI system prompt.
    travelStyle: body.travelStyle === "backpacker" ? "backpacker" : "classic",
    profilePreferences,
  };

  // Personalized generations bypass the cross-user cache in BOTH directions —
  // a cached generic itinerary would ignore the wishes, and a wish-tailored
  // result must not poison the shared pool (same rule as the JSON route).
  const isPersonalized = Boolean(params.mustDos?.length);
  // "Try Different Version" (the wizard's Regenerate) asks for a NEW plan.
  // The shared cache would hand back the very one on screen: 23 of 51
  // identical re-generations in 14 days came back in under 3 s (2026-09-26).
  // So the cache is not READ for it; the fresh result is still written, and
  // replaces the entry.
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

  // Authenticated-tier quota check + cross-user cache read in parallel.
  // They hit different tables (usage_limits vs activity_cache) and the
  // cache read needs userLanguage which is already resolved above. The
  // TTFB tradeoff is documented: hoisting the cache read here delays
  // SSE byte-0 by ~20-30ms but lets us skip the entire Gemini stream
  // on a hit — a much larger win on the conversion-critical first-day
  // event.
  const userIsAdmin = user ? isAdmin(user.email) : false;
  const [usageCheck, preflightCachedItinerary] = await Promise.all([
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
      // Never accept a cached entry SHORTER than the trip being asked for.
      // Computed inline because `totalDays` below is derived after this
      // parallel block and the lookup needs the number now.
      Math.ceil(
        (new Date(params.endDate).getTime() -
          new Date(params.startDate).getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1,
    ),
  ]);

  if (user && !usageCheck.allowed) {
    return errors.rateLimit(
      ("message" in usageCheck && usageCheck.message) ||
        "Monthly trip generation limit reached.",
      { usage: usageCheck, upgradeUrl: "/pricing" }
    );
  }

  const totalDays =
    Math.ceil(
      (new Date(params.endDate).getTime() -
        new Date(params.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;

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

    try {
      // 3a. Cache short-circuit (2026-05-28 — the "10-line patch" the
      //     original streaming author noted was missing). Before this,
      //     the streaming endpoint NEVER hit the cache — confirmed by
      //     prod data: 0 cache hits across 158 generations in 30 days.
      //     Now: backpacker + classic each have their own cache pool
      //     (Tier 1.2 migration) and the streaming path checks them
      //     before calling Gemini.
      // PERF (#190): the cache read was hoisted out of the SSE generator
      // and is now part of the pre-flight Promise.all above. We just
      // consume the pre-resolved value here.
      const cached = isPersonalized || wantsFresh ? null : preflightCachedItinerary;
      // `>= totalDays`, not `>= 1`. The cache key omits trip length, so a
      // 5-day entry used to answer a 14-day request and the user silently got
      // 5 days. adjustItineraryDates slices a LONGER entry down to fit, so
      // only too-short entries are rejected here.
      if (cached && cached.days.length >= totalDays) {
        const adjusted = adjustItineraryDates(
          cached,
          params.startDate,
          params.endDate,
        );
        finalItinerary = sanitizeItinerary(adjusted);
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

      // 3b. A long trip: an outline first, on screen at once, then the days
      //     written in parts at the same time. Without an outline the trip
      //     is written in one stream below.
      const outline = writesInParts(totalDays)
        ? await generateTripOutline(params, totalDays, userLanguage)
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
            logApiCall({
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
          yield { type: "day", data: day as unknown as import("@/lib/streaming/sse").SseDayData };
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
          finalItinerary = rescued as GeneratedItinerary;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          // The model answered, so Google billed it: log the failure and
          // its cost (this return used to skip logging altogether).
          waitUntil(
            logApiCall({
              apiName: "gemini",
              endpoint: "/api/ai/generate/stream",
              status: 500,
              responseTimeMs: Date.now() - startTime,
              cacheHit: false,
              costUsd: generationCost,
              exactCost: true,
              error: `unparseable output: ${msg}`,
              metadata: { user_id: user?.id ?? "anonymous", ...(generationId ? { generation_id: generationId } : {}) },
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

      // 6b. Cache write — only when we actually generated fresh.
      // Backpacker + classic each have their own cache pool (Tier 1.2
      // migration). Fire-and-forget via waitUntil so it never blocks
      // the complete event. Personalized (must-do) results never enter
      // the shared pool.
      // A fresh regenerate never replaces a LONGER entry: that entry still
      // answers requests up to its length (a 3-day redo would otherwise cost
      // every later 7-day request for the city a new generation).
      const shorterThanCached =
        wantsFresh &&
        (preflightCachedItinerary?.days.length ?? 0) > finalItinerary.days.length;
      if (!cacheHit && !isPersonalized && !shorterThanCached) {
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
            await logApiCall({
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
                ...(firstDayMs !== null ? { first_day_ms: firstDayMs } : {}),
                ...(parts > 0 ? { parts, outline_ms: outlineMs } : {}),
                ...(partRetries > 0 ? { part_retries: partRetries } : {}),
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
      const completeItinerary = { ...sanitized, language: userLanguage, timezone: deriveTimezoneFromItinerary(sanitized.days) ?? undefined };
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
        logApiCall({
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
          error: "Generation failed. Please try again.",
          code: "upstream",
        },
      };
    }
  };

  // 9b. Count an anonymous generation NOW, while the response headers can
  //     still carry the cookie. recordAnonymousGeneration() sets mt_anon
  //     through cookies(); it used to run after the stream (in the
  //     waitUntil above), when the headers were long sent, so the cookie
  //     never reached the browser and the 5-a-day anonymous cap never
  //     applied to the wizard (verified on production 2026-09-25: a fresh
  //     14-day generation left no mt_anon). Cache hits stay free, with the
  //     generator's own short-circuit predicate. A generation that then
  //     fails still counts: one of five, against no cap at all.
  const willHitCache =
    !isPersonalized &&
    !wantsFresh &&
    !!preflightCachedItinerary &&
    preflightCachedItinerary.days.length >= totalDays;
  if (isAnonymous && !willHitCache) {
    await recordAnonymousGeneration();
  }

  // 10. Build the SSE response.
  const stream = eventStreamFromGenerator(sseGenerator());
  return new Response(stream, {
    status: 200,
    headers: sseHeaders(),
  });
}
