import type { GeneratedItinerary, TripCreationParams } from "@/types";
import { getPrompt } from "./prompts";
import { captureLLMGeneration, type GeminiUsageMetadata } from "./posthog/llm-analytics";
import { getModelForPurpose, thinkingConfigFor } from "./ai/model-router";
import { logCacheMetrics } from "./ai/cache-metrics";
import { withDeduplication, getItineraryDedupKey } from "./gemini-dedup";
import { validateAndFixCoordinates } from "./trip/coordinate-fallback";
import { tripSpanDays } from "./dates/iso-date";
import { withServerFields } from "./ai/server-fields";
import { ensureTripSummary, tryRepairTruncatedJSON } from "./ai/itinerary-text";
import { inPlanCurrency } from "./ai/plan-currency";
import { buildStaticChatHistory, buildUserPrompt, type BuildPromptOptions } from "./ai/trip-prompt";
import {
  AI_REQUEST_TIMEOUT_MS,
  withRetries,
  type Attempt,
  genAI,
  withTimeout,
  MAX_RETRIES,
} from "@/lib/ai/gemini-call";

/**
 * How long to allow ONE itinerary generation, scaled by trip length.
 *
 * 50s suits the median 3-5 day trip, but a 14-day trip emits roughly three
 * times the tokens, and a fixed ceiling turns "slow" into "broken" for exactly
 * the trips that are hardest to produce. Capped at 90s so a single attempt
 * still fits inside the route's 120s Vercel maxDuration with room for the
 * surrounding work.
 */
export function itineraryTimeoutMs(days?: number): number {
  if (!days || days <= 7) return AI_REQUEST_TIMEOUT_MS;
  return Math.min(90_000, AI_REQUEST_TIMEOUT_MS + (days - 7) * 6_000);
}

// The trip-generation system prompt loads from the database via getPrompt();
// lib/prompts.ts holds the defaults and the database integration.

/**
 * Generation options for controlling output
 */
export type GenerationOptions = BuildPromptOptions;

export async function generateItinerary(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): Promise<GeneratedItinerary> {
  // Generate deduplication key from request parameters
  const dedupKey = getItineraryDedupKey({
    destination: params.destination,
    startDate: params.startDate,
    endDate: params.endDate,
    budgetTier: params.budgetTier,
    pace: params.pace,
    vibes: params.vibes,
    language: options?.language,
    anchorBrief: options?.anchorBrief,
  });

  // Wrap with deduplication to prevent duplicate concurrent requests
  return withDeduplication(dedupKey, () =>
    generateItineraryInternal(params, options)
  );
}

/**
 * Internal itinerary generation function (without deduplication wrapper)
 */
function generateItineraryInternal(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): Promise<GeneratedItinerary> {
  return withRetries((retryCount) => itineraryAttempt(params, options, retryCount), {
    retrying: "generation",
    gaveUp: "Failed to generate valid itinerary after retries",
    // Surface the underlying error so Sentry sees WHY we failed (403
    // key-banned, 429 quota, 503 outage, etc.). Preserve `cause` so the
    // original stack survives.
    unavailable: (error) => {
      const rootMsg =
        error instanceof Error ? error.message : String(error ?? "unknown");
      const wrapped = new Error(
        `Failed to generate itinerary: AI service unavailable (root: ${rootMsg.slice(0, 200)})`
      );
      if (error instanceof Error) {
        (wrapped as Error & { cause?: unknown }).cause = error;
      }
      return wrapped;
    },
  });
}

/** One attempt at the whole itinerary; a retry runs at a lower temperature. */
async function itineraryAttempt(
  params: TripCreationParams,
  options: (GenerationOptions & { userId?: string }) | undefined,
  retryCount: number
): Promise<Attempt<GeneratedItinerary>> {
  const startTime = performance.now();

  // Route through model-router so the routing matrix lives in one place.
  // trip-generation → gemini-2.5-flash.
  const modelName = getModelForPurpose("trip-generation");

  // Thinking is off (thinkingConfig below). gemini-2.5-flash thinks by
  // default: thinking tokens count against maxOutputTokens and, on a full
  // itinerary prompt, can push every attempt past its timeout. Structured JSON
  // output does not need deep reasoning. 2.5-pro rejects thinkingBudget 0
  // ("only works in thinking mode"), so this purpose must stay on a flash model.
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: retryCount > 0 ? 0.7 : 1.0, // Lower temperature on retry
      topP: 0.95,
      topK: 40,
      // A day costs ~750 output tokens and the wizard's MAX_TRIP_DAYS is 14
      // (~10.5k), so a lower cap cuts the longest trips short. Gemini bills
      // EMITTED output tokens, not the cap, so shorter trips cost the same.
      // Keep in sync with generateItineraryStream (same model, same prompt).
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  // Fetch system prompt from database (with caching and fallback)
  const systemPrompt = await getPrompt("trip_generation_system");

  // Shared static prefix (system prompt + output spec + ack) — identical
  // bytes across every request and across the streaming variant, so Gemini's
  // implicit prefix cache can engage (requires >=1024 identical tokens).
  const chat = model.startChat({
    history: buildStaticChatHistory(systemPrompt),
  });

  // options carries the response language and the anchored-trip brief.
  const userPrompt = buildUserPrompt(params, options);

  try {
    const result = await withTimeout(
      chat.sendMessage(userPrompt),
      itineraryTimeoutMs(tripSpanDays(params.startDate, params.endDate)),
      "Itinerary generation"
    );
    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("generateItinerary", response.usageMetadata, modelName);

    // Try to parse JSON, with a defensive repair pass for truncated output
    // (the model can hit maxOutputTokens mid-string).
    const parseAttempt = (source: string): GeneratedItinerary => {
      const itinerary = JSON.parse(source) as GeneratedItinerary;
      if (!itinerary.destination || !itinerary.days || itinerary.days.length === 0) {
        throw new Error("Invalid itinerary structure");
      }
      return itinerary;
    };

    let itinerary: GeneratedItinerary | null = null;
    let repairUsed = false;
    try {
      itinerary = parseAttempt(text);
    } catch (firstParseError) {
      const repaired = tryRepairTruncatedJSON(text);
      if (repaired) {
        try {
          itinerary = parseAttempt(repaired);
          repairUsed = true;
        } catch {
          /* repair didn't produce valid JSON either — fall through */
        }
      }
      if (!itinerary) {
        // Unrepairable: log, then retry or throw. Only the last attempt is an
        // error; one that is retried is a warning.
        (retryCount < MAX_RETRIES ? console.warn : console.error)(
          `JSON parse error (attempt ${retryCount + 1}):`,
          firstParseError instanceof Error ? firstParseError.message : "Unknown",
          "\nResponse preview:",
          text.substring(0, 500)
        );

        captureLLMGeneration({
          distinctId: options?.userId || "anonymous",
          model: modelName,
          endpoint: "generateItinerary",
          usageMetadata: response.usageMetadata as GeminiUsageMetadata,
          latencyMs,
          success: false,
          error: "JSON parse error",
          properties: {
            destination: params.destination,
            retry_count: retryCount,
          },
        }).catch(() => {});

        return { unusable: true };
      }
    }

    // Validate and fix coordinates for all activities
    itinerary.days = validateAndFixCoordinates(itinerary.days, params.destination);
    // Backfill trip_summary when missing (truncated tail) so wizard render
    // + persistTrip don't crash on `.trip_summary.total_estimated_cost`.
    ensureTripSummary(itinerary);
    withServerFields(itinerary, params);
    // In one currency before a multi-city or fixed-plan trip adds its parts up.
    await inPlanCurrency(itinerary);

    // Capture LLM analytics (fire and forget)
    captureLLMGeneration({
      distinctId: options?.userId || "anonymous",
      model: modelName,
      endpoint: "generateItinerary",
      usageMetadata: response.usageMetadata as GeminiUsageMetadata,
      latencyMs,
      success: true,
      properties: {
        destination: params.destination,
        duration_days: itinerary.days.length,
        budget_tier: params.budgetTier,
        pace: params.pace,
        vibes: params.vibes,
        retry_count: retryCount,
        repair_used: repairUsed,
      },
    }).catch(() => {});

    // If we needed to repair, log a breadcrumb (NOT a Sentry issue) so we can
    // still see repair frequency in Sentry tags/breadcrumbs without polluting
    // the issue stream ("warning" severity would surface each one as an issue).
    if (repairUsed) {
      const days = itinerary.days.length;
      const msg =
        `[gemini] tryRepairTruncatedJSON recovered a ${days}-day itinerary ` +
        `for "${params.destination}" (output ${text.length} chars).`;
      console.warn(msg);
      import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.addBreadcrumb?.({
            category: "gemini.repair",
            message: msg,
            level: "info",
            data: { destination: params.destination, days, output_chars: text.length },
          });
        })
        .catch(() => {});
    }

    return { value: itinerary };
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    // Handle API errors (rate limits, network issues, etc.)
    console.error("Gemini API error:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: options?.userId || "anonymous",
      model: modelName,
      endpoint: "generateItinerary",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    return { failed: error };
  }
}

// ============================================================================
// STREAMING ITINERARY GENERATION
// ============================================================================

/**
 * Yield type for `generateItineraryStream`. Each chunk carries the
 * incremental text Gemini emitted since the last yield. The terminal
 * yield is signalled by `done=true` and includes the fully-accumulated
 * text plus usage metadata.
 */
export interface StreamChunk {
  text: string; // incremental delta this chunk
  done: false;
}

export interface StreamFinal {
  text: ""; // empty delta — fullText is the canonical accumulation
  done: true;
  fullText: string;
  latencyMs: number;
  usageMetadata?: GeminiUsageMetadata;
}

export type StreamYield = StreamChunk | StreamFinal;

/**
 * Streaming counterpart to `generateItinerary`. Returns an async
 * generator that yields each partial-response chunk from Gemini, then
 * a terminal {done:true, fullText} payload.
 *
 * Caller responsibilities:
 *   - Maintain a streaming parser (see lib/streaming/day-parser.ts) to
 *     extract complete day objects from the running text
 *   - On terminal yield, do a full JSON.parse(fullText) to get the
 *     canonical GeneratedItinerary (use for cache writes, sanitization,
 *     image fetching)
 *   - Emit SSE events as days arrive (see lib/streaming/sse.ts)
 *
 * Differences from `generateItinerary`:
 *   - No retry-on-parse-failure loop. Streaming + retry would require
 *     replaying earlier chunks to the client, which we don't want. If
 *     the final parse fails, caller emits an SSE error.
 *   - No coordinate-fix pass — caller runs it on the parsed result.
 *   - No deduplication wrapper — concurrent streams to the same dest
 *     are rare (cache layer handles popular dests) and dedup would
 *     require fan-out, which is complex.
 *
 * Throws on Gemini API errors before the first chunk. Errors during
 * streaming surface as a rejected `next()` call — caller should
 * try/catch the `for await` block.
 */
export async function* generateItineraryStream(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): AsyncGenerator<StreamYield, void, unknown> {
  const startTime = performance.now();
  // Streaming trip generation → same purpose as the non-streaming path.
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
      // A day costs ~750 output tokens and the wizard's MAX_TRIP_DAYS is 14
      // (~10.5k), so a lower cap cuts the longest trips short. Gemini bills
      // EMITTED output tokens, not the cap, so shorter trips cost the same.
      // Keep in sync with generateItineraryInternal (same model, same prompt).
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      // Thinking OFF, as in generateItineraryInternal. gemini-2.5-flash thinks
      // by default and thinking tokens count against `maxOutputTokens`, so any
      // thinking budget can push the answer past the cap: the SSE stream then
      // emits a valid prefix of an invalid JSON ("Unterminated string" in
      // parseStreamedItinerary).
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  const systemPrompt = await getPrompt("trip_generation_system");
  // Same shared static prefix as the blocking call site — one cache entry
  // serves both paths.
  const chat = model.startChat({
    history: buildStaticChatHistory(systemPrompt),
  });

  const userPrompt = buildUserPrompt(params, options);

  // sendMessageStream returns { stream: AsyncIterable, response: Promise }
  // The `stream` iterates partial responses; `response` resolves to the
  // final aggregated response after the stream completes.
  const result = await chat.sendMessageStream(userPrompt);

  try {
    for await (const partial of result.stream) {
      // Each partial may yield zero text if it's a control message
      // (e.g. safety scores updated). Defensive: only yield when
      // there's actual text.
      const delta = partial.text();
      if (delta) {
        yield { text: delta, done: false };
      }
    }
  } catch (err) {
    // Async-iter rejections are silently dropped by `for await` in some
    // engines; explicit rethrow keeps the caller's try/catch effective.
    throw err instanceof Error ? err : new Error(String(err));
  }

  // Aggregate final response. CRITICAL: the canonical text is
  // finalResponse.text(), NOT the deltas joined together.
  // The async-iter `for await` can silently drop chunks under back-
  // pressure, while the final aggregate is complete. Use it as truth.
  const finalResponse = await result.response;
  const canonicalText = finalResponse.text();
  const latencyMs = performance.now() - startTime;
  logCacheMetrics("generateItineraryStream", finalResponse.usageMetadata, modelName);

  // Fire-and-forget LLM analytics — same shape as generateItinerary.
  captureLLMGeneration({
    distinctId: options?.userId || "anonymous",
    model: modelName,
    endpoint: "generateItineraryStream",
    usageMetadata: finalResponse.usageMetadata as GeminiUsageMetadata,
    latencyMs,
    success: true,
    properties: {
      destination: params.destination,
      budget_tier: params.budgetTier,
      pace: params.pace,
      vibes: params.vibes,
    },
  }).catch(() => {});

  yield {
    text: "",
    done: true,
    fullText: canonicalText,
    latencyMs,
    usageMetadata: finalResponse.usageMetadata as GeminiUsageMetadata,
  };
}
