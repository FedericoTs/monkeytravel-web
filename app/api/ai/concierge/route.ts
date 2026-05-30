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
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { recordAiOutcome } from "@/lib/ai/observability";
import type { ItineraryDay } from "@/types";

const MAX_QUESTION_LENGTH = 800;
const MAX_RESPONSE_TOKENS = 500;

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
    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .select("id, title, destination, start_date, end_date, itinerary")
      .eq("id", tripId)
      .maybeSingle();
    if (tripErr) {
      console.error("[concierge] trip load failed", tripErr);
      return errors.internal("Failed to load trip context", "concierge");
    }
    if (!trip) {
      return errors.notFound(
        "Trip not found or you don't have access to it"
      );
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

    // Call Gemini. flash-lite is fine — concierge questions are short
    // and don't need standard tier. Saves ~75% on input cost.
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return errors.serviceUnavailable("AI not configured");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
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

          try {
            const result = await model.generateContentStream({
              contents: promptContents,
            });
            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) emit({ type: "chunk", text });
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
              model: "gemini-2.5-flash-lite",
              durationMs: Date.now() - startTime,
              userId: user.id,
              metadata: {
                subroute: "concierge",
                streamed: true,
                is_live_trip: todaySlice !== null,
              },
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
              model: "gemini-2.5-flash-lite",
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
    } catch (err) {
      console.error("[concierge] Gemini call failed", err);

      void recordAiOutcome({
        endpoint: "assistant", // bucket under the same tag — concierge is
        // the same conceptual surface as the planning assistant
        outcome: "failure",
        model: "gemini-2.5-flash-lite",
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
      model: "gemini-2.5-flash-lite",
      durationMs: Date.now() - startTime,
      userId: user.id,
      metadata: {
        subroute: "concierge",
        is_live_trip: todaySlice !== null,
      },
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
    destination?: string;
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
    destination: trip.destination,
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
