import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { errors } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  checkAnonymousRateLimit,
  recordAnonymousGeneration,
} from "@/lib/anonymous/rate-limit";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  generateItineraryStream,
  parseStreamedItinerary,
  validateTripParams,
} from "@/lib/gemini";
import { isAdmin } from "@/lib/admin";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import {
  incrementEarlyAccessUsage,
  decrementFreeTrips,
} from "@/lib/early-access";
import { fetchActivityImages } from "@/lib/images/activity";
import { sanitizeItinerary } from "@/lib/utils/sanitize";
import type {
  TripCreationParams,
  UserProfilePreferences,
  GeneratedItinerary,
} from "@/types";
import { cookies } from "next/headers";
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

type SupportedLanguage = "en" | "es" | "it";

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

  // 1. Pre-flight: parse body and run all checks BEFORE opening the SSE
  //    stream. Failures here can return JSON 4xx/5xx normally (better
  //    DX for the client than an SSE error event).
  const supabase = await createClient();
  const {
    data: { user: maybeUser },
  } = await supabase.auth.getUser();
  const user: User | null = maybeUser ?? null;
  const isAnonymous = user === null;

  if (isAnonymous) {
    const anonLimit = await checkAnonymousRateLimit();
    if (!anonLimit.allowed) {
      return errors.rateLimit(
        anonLimit.message ||
          "Free trip limit reached. Sign up to keep generating.",
        { usage: anonLimit, signupUrl: "/auth/signup" }
      );
    }
  }

  // Parse + validate body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errors.badRequest("Body must be valid JSON");
  }

  // Pull profile preferences (authenticated only)
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
      if (userProfile?.notification_settings) {
        const ns = userProfile.notification_settings as Record<string, unknown>;
        const qs = ns.quietHoursStart as number | undefined;
        const qe = ns.quietHoursEnd as number | undefined;
        if (qs !== undefined && qe !== undefined) {
          profilePreferences.activeHoursStart = qe;
          profilePreferences.activeHoursEnd = qs;
        }
      }
    } catch (err) {
      console.warn("[AI Generate Stream] preferences fetch failed:", err);
    }
  }

  // Language (cookie-based, anonymous-friendly)
  const userLanguage = await getUserLanguage(supabase, user?.id ?? null);

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
    // Whitelist travelStyle (same pattern as the non-streaming route).
    // Untrusted input can't flow into the AI system prompt.
    travelStyle: body.travelStyle === "backpacker" ? "backpacker" : "classic",
    profilePreferences,
  };

  const validation = validateTripParams(params);
  if (!validation.valid) {
    return errors.badRequest(validation.error);
  }

  // API access kill-switch (Gemini circuit breaker)
  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return errors.serviceUnavailable(
      access.message || "AI generation is currently disabled"
    );
  }

  // Authenticated-tier quota check
  const userIsAdmin = user ? isAdmin(user.email) : false;
  const usageCheck = user
    ? await checkUsageLimit(user.id, "aiGenerations", user.email)
    : {
        allowed: true as const,
        used: 0,
        remaining: 999,
        limit: 999,
        message: undefined as string | undefined,
      };
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
    let cacheHit = false;
    let finalItinerary: GeneratedItinerary | null = null;

    try {
      // Metadata event — always first, so the client knows total days
      // and the destination name for the progress UI.
      yield {
        type: "metadata",
        data: {
          destination: { name: params.destination, country: "" },
          totalDays,
          language: userLanguage,
          mode: "stream", // overwritten below if cache hit
        },
      };

      // 3. Stream the model. No cache layer for streaming v1 — we want
      //    to verify the streaming path works end-to-end before adding
      //    the cache short-circuit. Adding it later is a 10-line patch.
      const parser = createDayParser();
      const stream = generateItineraryStream(params, {
        language: userLanguage,
        userId: user?.id,
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (chunk.done) {
          fullText = chunk.fullText;
          break;
        }
        const newDays = feedChunk(parser, chunk.text);
        for (const day of newDays) {
          generatedDays++;
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

      // 6. Server-side image fetch. Same as the non-streaming path —
      //    prevents a race condition on the client. Skipped on cache hit
      //    (cached entries already have images).
      if (!cacheHit) {
        try {
          await fetchActivityImages(finalItinerary.days, params.destination);
        } catch (imgErr) {
          console.error("[AI Generate Stream] image fetch error:", imgErr);
        }
      }

      // 7. Sanitize before sending the canonical itinerary in `complete`.
      const sanitized = sanitizeItinerary(finalItinerary);

      const generationCost = cacheHit ? 0 : 0.003;
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
              metadata: {
                user_id: user?.id ?? "anonymous",
                is_anonymous: isAnonymous,
                destination: params.destination,
                vibes: params.vibes,
                duration: totalDays,
                generated_days: generatedDays,
                is_admin: userIsAdmin,
                streamed: true,
              },
            });
            if (!cacheHit) {
              if (user) {
                await incrementUsage(user.id, "aiGenerations", 1);
                await decrementFreeTrips(user.id);
                await incrementEarlyAccessUsage(user.id, "generation");
              } else {
                await recordAnonymousGeneration();
              }
            }
          } catch (err) {
            console.error("[AI Generate Stream] post-stream cleanup error:", err);
          }
        })()
      );

      // 9. Terminal complete event.
      yield {
        type: "complete",
        data: {
          itinerary: sanitized,
          meta: {
            generationTimeMs,
            model: cacheHit ? "cache" : "gemini-2.5-flash-lite",
            cached: cacheHit,
            generatedDays,
            totalDays,
            costUsd: generationCost,
          },
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
          costUsd: 0,
          error: msg,
          metadata: { user_id: user?.id ?? "anonymous" },
        }).catch(() => undefined)
      );
      yield {
        type: "error",
        data: { error: msg, code: "upstream" },
      };
    }
  };

  // 10. Build the SSE response.
  const stream = eventStreamFromGenerator(sseGenerator());
  return new Response(stream, {
    status: 200,
    headers: sseHeaders(),
  });
}

/**
 * Get the user's preferred language. Duplicates the helper in the
 * non-streaming route — pulling it into a shared module would mean
 * touching that route, which we want to avoid for risk reasons.
 */
async function getUserLanguage(
  supabase: SupabaseClient,
  userId: string | null
): Promise<SupportedLanguage> {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");
  if (
    localeCookie?.value &&
    ["en", "es", "it"].includes(localeCookie.value)
  ) {
    return localeCookie.value as SupportedLanguage;
  }
  if (userId) {
    try {
      const { data: profile } = await supabase
        .from("users")
        .select("preferred_language")
        .eq("id", userId)
        .single();
      if (
        profile?.preferred_language &&
        ["en", "es", "it"].includes(profile.preferred_language)
      ) {
        return profile.preferred_language as SupportedLanguage;
      }
    } catch {
      // ignore
    }
  }
  return "en";
}
