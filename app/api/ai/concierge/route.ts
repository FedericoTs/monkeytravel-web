/**
 * POST /api/ai/concierge
 *
 * The in-trip concierge: answers a question about ONE trip, streamed as
 * server-sent events. Differs from /api/ai/assistant in three deliberate ways:
 *   1. It writes nothing. An answer may carry one proposal
 *      (lib/ai/concierge-proposal.ts), which the traveller confirms through
 *      /api/ai/assistant/apply.
 *   2. Today-aware: when the current date falls inside the trip window,
 *      today's activities and day number are in the prompt, so the traveller
 *      can ask "what's nearby for lunch?" without restating context.
 *   3. One row per turn instead of a thread; the last few are replayed as its
 *      memory (lib/ai/concierge-trip.ts, lib/ai/concierge-answer.ts).
 *
 * Quota: shares aiAssistantMessages with the planning assistant. One
 * concierge ask = one assistant message.
 *
 * Failure modes route through lib/ai/observability.recordAiOutcome so
 * concierge failures show up in the same Sentry dashboard as the rest
 * of the AI surface.
 */

import { NextRequest } from "next/server";
import { conciergeAnswerStream, conciergePrompt } from "@/lib/ai/concierge-answer";
import { buildTripContext, loadConciergeMemory, loadConciergeTrip, loadDayProgress, resolveTodaySlice } from "@/lib/ai/concierge-trip";
import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { tripLocale } from "@/lib/ai/language";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { recordAiOutcome } from "@/lib/ai/observability";
import { checkApiAccess } from "@/lib/api-gateway";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/api/json-body";
import { errors } from "@/lib/api/response-wrapper";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import type { ItineraryDay } from "@/types";

const MAX_QUESTION_LENGTH = 800;
// The answer plus one proposal line, with room to spare: a cut answer loses
// the proposal, which comes last.
const MAX_RESPONSE_TOKENS = 1024;

interface ConciergeRequestBody {
  tripId?: string;
  question?: string;
  /**
   * The traveller's LOCAL calendar date (YYYY-MM-DD). The server's UTC clock is
   * off by one for evening users in the Americas, precisely the "we're behind
   * schedule tonight" moment the concierge exists for. Server UTC stays as the
   * fallback.
   */
  clientToday?: string;
  /**
   * Client-side edit counter. Bumped after every applied proposal and mixed
   * into the trip memo's key, so a follow-up question after an apply can never
   * be answered from the pre-edit row. (Invalidating the memo from the /apply
   * route can't work: a different lambda.)
   */
  itineraryVersion?: number;
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
      return errors.serviceUnavailable(access.message || "AI is currently unavailable");
    }

    const { body, invalidBody } = await readJsonBody<ConciergeRequestBody>(request);
    if (invalidBody) return invalidBody;

    const tripId = typeof body.tripId === "string" ? body.tripId : null;
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const clientToday =
      typeof body.clientToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.clientToday) ? body.clientToday : null;
    const itineraryVersion =
      typeof body.itineraryVersion === "number" && Number.isFinite(body.itineraryVersion)
        ? Math.max(0, Math.floor(body.itineraryVersion))
        : 0;
    if (!tripId) return errors.badRequest("tripId is required");
    if (!question) return errors.badRequest("question is required");
    if (question.length > MAX_QUESTION_LENGTH) {
      return errors.badRequest(`question too long (max ${MAX_QUESTION_LENGTH} chars)`);
    }

    // Quota check — share the assistant bucket so we don't introduce a
    // separate counter the user has to track. 20/day on free tier.
    const usage = await checkUsageLimit(user.id, "aiAssistantMessages", user.email);
    if (!usage.allowed) {
      return errors.forbidden(usage.message || "Daily AI limit reached. Try again tomorrow or upgrade.", "USAGE_LIMIT_REACHED");
    }

    const { trip, errorResponse: tripRefused } = await loadConciergeTrip(supabase, user.id, tripId, itineraryVersion);
    if (tripRefused) return tripRefused;

    const itinerary = Array.isArray(trip.itinerary) ? (trip.itinerary as ItineraryDay[]) : [];
    const todaySlice = resolveTodaySlice(String(trip.start_date), String(trip.end_date), itinerary, clientToday);
    const progress = todaySlice ? await loadDayProgress(supabase, tripId, todaySlice.dayNumber) : new Map<string, string>();
    const memory = await loadConciergeMemory(user.id, tripId);

    // Call Gemini. Routed via model-router → concierge maps to
    // gemini-2.5-flash, not flash-lite, which struggles with multi-day
    // context.
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return errors.serviceUnavailable("AI not configured");
    }
    const conciergeModel = getModelForPurpose("concierge");
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: conciergeModel,
      generationConfig: {
        temperature: 0.6, // some warmth but mostly factual
        maxOutputTokens: MAX_RESPONSE_TOKENS,
        // Thinking off: flash thinks by default and its thinking tokens count
        // against the cap, which spent it before the answer was written.
        thinkingConfig: thinkingConfigFor(conciergeModel),
      },
    });
    const tripLanguage = tripLocale(trip.trip_meta);

    // Before streaming starts, so a client disconnecting mid-stream doesn't leak
    // the cost-cap accounting.
    void incrementUsage(user.id, "aiAssistantMessages").catch((err) => {
      console.error("[concierge] usage increment failed", err);
    });

    const stream = conciergeAnswerStream({
      model,
      modelName: conciergeModel,
      contents: conciergePrompt({
        question,
        memory,
        tripContext: buildTripContext(trip, todaySlice, progress),
        tripLanguage,
      }),
      question,
      itinerary,
      tripCurrency: (trip.budget as { currency?: string } | null)?.currency || "USD",
      tripLanguage,
      todaySlice,
      userId: user.id,
      tripId,
      startTime,
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
