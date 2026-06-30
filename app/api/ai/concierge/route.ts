/**
 * POST /api/ai/concierge
 *
 * F4 In-trip AI Concierge MVP (task #242). A context-aware single-turn
 * Q&A endpoint scoped to ONE trip. Differs from /api/ai/assistant in
 * three deliberate ways:
 *   1. Read-only: never mutates the trip. The system prompt enforces this.
 *      Means we don't need the heavy schema-modification machinery the
 *      planning assistant has.
 *   2. Today-aware: when the current date falls inside the trip window,
 *      we pre-inject today's activities + day number so the user can ask
 *      "what's nearby for lunch?" without restating context.
 *   3. Single-turn, no persistence (v1): the UI is a question→answer
 *      flow, not a conversation. Lower cost, lower complexity, lower
 *      latency. Adds conversation history in v2 if usage justifies.
 *
 * Quota: shares aiAssistantMessages with the planning assistant. One
 * concierge ask = one assistant message. Free tier = 20/day total
 * (already-existing bucket).
 *
 * Failure modes route through lib/ai/observability.recordAiOutcome so
 * concierge failures show up in the same Sentry dashboard as the rest
 * of the AI surface (task #223 wiring).
 */

import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logCacheMetrics } from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { recordAiOutcome } from "@/lib/ai/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItineraryDay, TripMeta } from "@/types";
import { getTripDestination } from "@/lib/trips/destination";

/**
 * Persist a Concierge Q&A turn to `ai_conversations`.
 *
 * The F4 v1 spec called for "no persistence" (the chat UI is single-turn,
 * not threaded). But that left us paying Gemini for answers we couldn't
 * see — the david-cassoni incident (7 questions over 17 min, all lost
 * when the trip got deleted) made the cost concrete. We now log every
 * turn so we can:
 *   - audit which questions drive the most quota usage
 *   - mine common asks for FAQ / canned-answer surfaces
 *   - reconstruct user sessions when a trip later disappears
 *
 * One row per turn (Q + A pair) — simpler than maintaining a thread.
 * Group by (user_id, trip_id, day_bucket) at query time if we ever want
 * conversation threading.
 *
 * Service-role client — `ai_conversations` has RLS enabled with zero
 * policies (service-role-only), which is correct: there's no UI yet
 * that reads these rows, and an accidental anon-readable policy would
 * leak prompt content.
 *
 * Fire-and-forget. Never blocks the user's answer.
 */
async function persistConciergeTurn(input: {
  userId: string;
  tripId: string;
  question: string;
  answer: string;
  model: string;
  isLiveTrip: boolean;
  dayNumber: number | null;
  streamed: boolean;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const { error } = await supabase.from("ai_conversations").insert({
      user_id: input.userId,
      trip_id: input.tripId,
      messages: [
        {
          role: "user",
          content: input.question,
          timestamp: now,
        },
        {
          role: "assistant",
          content: input.answer,
          model: input.model,
          timestamp: now,
        },
      ],
      context: {
        surface: "concierge_f4",
        is_live_trip: input.isLiveTrip,
        day_number: input.dayNumber,
        streamed: input.streamed,
      },
    });
    if (error) {
      console.error("[concierge] persist turn failed", error);
    }
  } catch (err) {
    // Never let a logging path break the user-facing answer.
    console.error("[concierge] persist turn threw", err);
  }
}

const MAX_QUESTION_LENGTH = 800;
const MAX_RESPONSE_TOKENS = 500;

/**
 * Per-process trip-context cache.
 *
 * Concierge users typically fire 2-3 follow-up questions in a row about the
 * same open trip. Each request previously triggered a fresh Supabase SELECT
 * of the full itinerary JSONB — a noticeable share of DB load on heavy days
 * and pure waste, since the trip rarely changes mid-conversation.
 *
 * We key by `${userId}|${tripId}` so collaborators on a shared trip don't
 * leak each other's RLS view (RLS still ran for the cached row when we
 * first fetched it for that user). 60s TTL is short enough that "Modifica
 * Viaggio" edits become visible quickly, long enough to catch the realistic
 * follow-up window.
 *
 * In-process Map. No cross-instance coherence — that's fine: stale reads
 * are at worst 60s old and the next instance will warm its own cache.
 */
type TripRow = {
  id: string;
  title?: string;
  // The canonical destination lives in trip_meta.destination — there is NO
  // trips.destination column (it was migrated away). getTripDestination()
  // reads it with a title-strip fallback. Selecting a `destination` column
  // here previously 500'd every authenticated request (42703).
  trip_meta?: TripMeta | null;
  start_date: string;
  end_date: string;
  itinerary?: unknown;
};

const TRIP_CACHE_TTL_MS = 60_000;
const tripContextCache = new Map<
  string,
  { row: TripRow; expiresAt: number }
>();

function getCachedTrip(userId: string, tripId: string): TripRow | null {
  const key = `${userId}|${tripId}`;
  const entry = tripContextCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tripContextCache.delete(key);
    return null;
  }
  return entry.row;
}

function setCachedTrip(userId: string, tripId: string, row: TripRow): void {
  const key = `${userId}|${tripId}`;
  tripContextCache.set(key, {
    row,
    expiresAt: Date.now() + TRIP_CACHE_TTL_MS,
  });
}

const SYSTEM_PROMPT = `You are MonkeyTravel's in-trip Concierge — a real-time travel companion for a SPECIFIC saved trip the user has open right now.

RULES:
1. Answer the user's question concisely and practically. Maximum 4 short paragraphs unless they ask for more.
2. The user's saved itinerary is provided as JSON below — reference SPECIFIC activities/days when relevant. Don't pretend you don't know the plan.
3. Read-only mode: you do NOT modify the itinerary. If they ask to add/remove an activity, suggest they use the "Modifica Viaggio" / "Edit Trip" button.
4. When TODAY'S CONTEXT is provided, prioritize answers grounded in today's activities + day number. The user is likely physically on the trip.
5. Never invent venues, opening hours, prices, or coordinates. If asked something the itinerary doesn't cover, say "I don't have that in your plan — want me to suggest options?" and offer 2-3 generic ideas tied to the destination.
6. Match the user's language: respond in the same language they wrote in.
7. No emojis. No markdown headers. Plain prose with at most a short bullet list when listing 3+ items.`;

interface ConciergeRequestBody {
  tripId?: string;
  question?: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Cost guard before parsing body so a flood of unauth requests can't
    // chew through the body-parsing layer either.
    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      return errors.serviceUnavailable(
        access.message || "AI is currently unavailable"
      );
    }

    let body: ConciergeRequestBody;
    try {
      body = (await request.json()) as ConciergeRequestBody;
    } catch {
      return errors.badRequest("Invalid JSON body");
    }

    const tripId = typeof body.tripId === "string" ? body.tripId : null;
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!tripId) return errors.badRequest("tripId is required");
    if (!question) return errors.badRequest("question is required");
    if (question.length > MAX_QUESTION_LENGTH) {
      return errors.badRequest(
        `question too long (max ${MAX_QUESTION_LENGTH} chars)`
      );
    }

    // Quota check — share the assistant bucket so we don't introduce a
    // separate counter the user has to track. 20/day on free tier.
    const usage = await checkUsageLimit(
      user.id,
      "aiAssistantMessages",
      user.email
    );
    if (!usage.allowed) {
      return errors.forbidden(
        usage.message ||
          "Daily AI limit reached. Try again tomorrow or upgrade.",
        "USAGE_LIMIT_REACHED"
      );
    }

    // Load the trip — owner OR collaborator (RLS handles that filter).
    // We pull only the fields the prompt needs to keep tokens down.
    //
    // 60s per-process memo: same (user, trip) follow-ups (the common case)
    // skip the SELECT entirely. RLS still ran for this user on the first
    // fetch, so caching the row is safe — we only serve it back to the
    // same userId. See `getCachedTrip` / `setCachedTrip` above.
    let trip = getCachedTrip(user.id, tripId);
    if (!trip) {
      const { data: row, error: tripErr } = await supabase
        .from("trips")
        .select("id, title, start_date, end_date, itinerary, trip_meta")
        .eq("id", tripId)
        .maybeSingle();
      if (tripErr) {
        console.error("[concierge] trip load failed", tripErr);
        return errors.internal("Failed to load trip context", "concierge");
      }
      if (!row) {
        return errors.notFound(
          "Trip not found or you don't have access to it"
        );
      }
      trip = row as TripRow;
      setCachedTrip(user.id, tripId, trip);
    }

    // Resolve today's day-in-trip if we're inside the trip window.
    // Using UTC date math throughout — local time is the user's
    // browser concern, not the server's.
    const todaySlice = resolveTodaySlice(
      String(trip.start_date),
      String(trip.end_date),
      Array.isArray(trip.itinerary)
        ? (trip.itinerary as ItineraryDay[])
        : []
    );

    const tripContext = buildTripContext(trip, todaySlice);

    // Call Gemini. Routed via model-router → concierge maps to
    // gemini-2.5-flash per the 2026-05-31 audit (audit bumped this from
    // the previous flash-lite to flash for better contextual answers on
    // longer trip plans — flash-lite struggled with multi-day context).
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return errors.serviceUnavailable("AI not configured");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const conciergeModel = getModelForPurpose("concierge");
    const model = genAI.getGenerativeModel({
      model: conciergeModel,
      generationConfig: {
        temperature: 0.6, // some warmth but mostly factual
        maxOutputTokens: MAX_RESPONSE_TOKENS,
      },
    });

    const promptContents = [
      { role: "user" as const, parts: [{ text: SYSTEM_PROMPT }] },
      {
        role: "model" as const,
        parts: [
          {
            text: "Understood. I'll answer concisely, ground in the itinerary, and never modify the plan.",
          },
        ],
      },
      {
        role: "user" as const,
        parts: [
          {
            text: `TRIP CONTEXT (JSON):\n${tripContext}\n\nUSER QUESTION:\n${question}`,
          },
        ],
      },
    ];

    // STREAMING PATH (perf task #245).
    // When the client sends `Accept: text/event-stream` we pipe Gemini's
    // chunked output as SSE events. Perceived latency drops from ~3s to
    // ~200ms for the first token. The non-streaming branch below stays
    // as a backwards-compatible fallback for HTTP clients that can't
    // read streams (Capacitor older-WebView, server-side callers, etc).
    const wantsStream =
      request.headers.get("accept")?.includes("text/event-stream") ?? false;

    if (wantsStream) {
      // Side-effect work that must happen regardless of stream outcome.
      // We fire the usage bump + observability BEFORE streaming starts
      // so client disconnects mid-stream don't leak the cost-cap accounting.
      void incrementUsage(user.id, "aiAssistantMessages").catch((err) => {
        console.error("[concierge] usage increment failed", err);
      });

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const emit = (payload: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          };

          // Server-side accumulation so we can persist the full answer
          // alongside the question after the stream completes. The client
          // also accumulates for display — this is the audit copy.
          let accumulated = "";
          try {
            const result = await model.generateContentStream({
              contents: promptContents,
            });
            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) {
                accumulated += text;
                emit({ type: "chunk", text });
              }
            }

            // Wire prompt-cache hit-rate monitoring. The SDK exposes the
            // aggregated final response (with usageMetadata) on
            // `result.response` once the stream is fully consumed —
            // best-effort, never block the user's "done" event on it.
            try {
              const finalResponse = await result.response;
              logCacheMetrics("ai.concierge.stream", finalResponse.usageMetadata);
            } catch {
              /* usageMetadata is best-effort — don't fail the request */
            }

            emit({
              type: "done",
              isLiveTrip: todaySlice !== null,
              dayNumber: todaySlice?.dayNumber ?? null,
            });

            // Success path observability — DB log + Sentry breadcrumb.
            // Done in start() so it sees the final duration.
            void logApiCall({
              apiName: "gemini",
              endpoint: "/api/ai/concierge",
              status: 200,
              responseTimeMs: Date.now() - startTime,
              cacheHit: false,
              costUsd: 0.0005,
              metadata: {
                user_id: user.id,
                trip_id: tripId,
                is_live_trip: todaySlice !== null,
                streamed: true,
              },
            }).catch(() => {});

            void recordAiOutcome({
              endpoint: "assistant",
              outcome: "success",
              model: conciergeModel,
              durationMs: Date.now() - startTime,
              userId: user.id,
              metadata: {
                subroute: "concierge",
                streamed: true,
                is_live_trip: todaySlice !== null,
              },
            });

            // Persist the Q&A pair. Fire-and-forget. Trim before writing
            // so we don't store the streaming-artifact trailing whitespace
            // that the client also strips.
            void persistConciergeTurn({
              userId: user.id,
              tripId,
              question,
              answer: accumulated.trim(),
              model: conciergeModel,
              isLiveTrip: todaySlice !== null,
              dayNumber: todaySlice?.dayNumber ?? null,
              streamed: true,
            });
          } catch (err) {
            console.error("[concierge] streaming Gemini call failed", err);
            emit({
              type: "error",
              message: "Couldn't answer right now. Try again in a moment.",
            });

            void recordAiOutcome({
              endpoint: "assistant",
              outcome: "failure",
              model: conciergeModel,
              durationMs: Date.now() - startTime,
              error: err,
              userId: user.id,
              metadata: { subroute: "concierge", streamed: true },
            });

            void logApiCall({
              apiName: "gemini",
              endpoint: "/api/ai/concierge",
              status: 500,
              responseTimeMs: Date.now() - startTime,
              cacheHit: false,
              costUsd: 0,
              error: err instanceof Error ? err.message : "unknown",
            }).catch(() => {});
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          // Disable Vercel's edge buffering for SSE so chunks reach the
          // client as Gemini emits them (otherwise we get the full
          // response in one shot at the end — defeating the point).
          "X-Accel-Buffering": "no",
        },
      });
    }

    // NON-STREAMING fallback path (callers without Accept: text/event-stream).
    let responseText: string;
    try {
      const result = await model.generateContent({
        contents: promptContents,
      });
      responseText = result.response.text().trim();

      // Wire prompt-cache hit-rate monitoring (see lib/gemini.ts).
      // The concierge SYSTEM_PROMPT is a stable prefix — should see a
      // high implicit-cache-hit rate. If this drops, we've added a
      // non-cacheable prefix and are silently leaking money.
      logCacheMetrics("ai.concierge", result.response.usageMetadata);
    } catch (err) {
      console.error("[concierge] Gemini call failed", err);

      void recordAiOutcome({
        endpoint: "assistant", // bucket under the same tag — concierge is
        // the same conceptual surface as the planning assistant
        outcome: "failure",
        model: conciergeModel,
        durationMs: Date.now() - startTime,
        error: err,
        userId: user.id,
        metadata: { subroute: "concierge" },
      });

      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/concierge",
        status: 500,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: err instanceof Error ? err.message : "unknown",
      });

      return errors.internal(
        "Couldn't answer right now. Try again in a moment.",
        "concierge"
      );
    }

    if (!responseText) {
      return errors.internal("Empty response from AI", "concierge");
    }

    // Bump the per-user quota. Fire-and-forget — never block the answer
    // on the counter update.
    void incrementUsage(user.id, "aiAssistantMessages").catch((err) => {
      console.error("[concierge] usage increment failed", err);
    });

    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/concierge",
      status: 200,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0.0005, // rough estimate — concierge calls are tiny
      metadata: {
        user_id: user.id,
        trip_id: tripId,
        is_live_trip: todaySlice !== null,
      },
    });

    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "success",
      model: conciergeModel,
      durationMs: Date.now() - startTime,
      userId: user.id,
      metadata: {
        subroute: "concierge",
        is_live_trip: todaySlice !== null,
      },
    });

    // Persist the Q&A pair (non-streaming path).
    void persistConciergeTurn({
      userId: user.id,
      tripId,
      question,
      answer: responseText,
      model: conciergeModel,
      isLiveTrip: todaySlice !== null,
      dayNumber: todaySlice?.dayNumber ?? null,
      streamed: false,
    });

    return apiSuccess({
      answer: responseText,
      isLiveTrip: todaySlice !== null,
      dayNumber: todaySlice?.dayNumber ?? null,
    });
  } catch (err) {
    console.error("[concierge] unexpected error", err);

    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "failure",
      durationMs: Date.now() - startTime,
      error: err,
      metadata: { subroute: "concierge" },
    });

    return errors.internal("Concierge failed", "concierge");
  }
}

/**
 * Resolve today's day-in-trip slice. Returns null when the current
 * date is before the trip starts or after it ends — we still answer
 * questions, but skip the "today" framing in the prompt.
 *
 * Date math uses local-day comparison via toLocaleDateString-style
 * UTC midnight, which is what the trip dates were stored as.
 */
function resolveTodaySlice(
  startDate: string,
  endDate: string,
  itinerary: ItineraryDay[]
): { dayNumber: number; activities: ItineraryDay["activities"] } | null {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const start = new Date(startDate);
  const startUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const end = new Date(endDate);
  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  if (today < startUtc || today > endUtc) return null;

  const diffDays = Math.floor((today - startUtc) / (24 * 60 * 60 * 1000));
  const dayNumber = diffDays + 1; // 1-indexed
  const day = itinerary.find((d) => d.day_number === dayNumber);
  if (!day) return { dayNumber, activities: [] };
  return { dayNumber, activities: day.activities ?? [] };
}

/**
 * Build a compact JSON-string context for the prompt. We deliberately
 * strip metadata fields the model doesn't need (timestamps, IDs, image
 * URLs) so we don't burn tokens for noise.
 */
function buildTripContext(
  trip: {
    title?: string;
    trip_meta?: TripMeta | null;
    start_date?: string;
    end_date?: string;
    itinerary?: unknown;
  },
  todaySlice: {
    dayNumber: number;
    activities: ItineraryDay["activities"];
  } | null
): string {
  const days = Array.isArray(trip.itinerary)
    ? (trip.itinerary as ItineraryDay[]).map((d) => ({
        day_number: d.day_number,
        date: d.date,
        activities: (d.activities ?? []).map((a) => ({
          time_slot: a.time_slot,
          name: a.name,
          type: a.type,
          location: a.location || a.address || undefined,
          duration_minutes: a.duration_minutes,
        })),
      }))
    : [];

  const out: Record<string, unknown> = {
    title: trip.title,
    destination: getTripDestination({ title: trip.title, trip_meta: trip.trip_meta }),
    start_date: trip.start_date,
    end_date: trip.end_date,
    total_days: days.length,
    itinerary: days,
  };
  if (todaySlice) {
    out.today = {
      day_number: todaySlice.dayNumber,
      activities: todaySlice.activities.map((a) => ({
        time_slot: a.time_slot,
        name: a.name,
        type: a.type,
        location: a.location || a.address || undefined,
      })),
    };
  }
  return JSON.stringify(out);
}
