/**
 * POST /api/ai/concierge-anon — read-only trip Q&A for the ANONYMOUS
 * generation-result view (pre-save, no auth, no persisted trip).
 *
 * Unlike /api/ai/concierge (auth + tripId + DB load), this takes the in-memory
 * itinerary as a payload and answers questions about it. READ-ONLY: it never
 * edits the trip. Guards mirror /api/ai/decide — this is an unauthenticated AI
 * surface, so it gets its own per-IP + burst limiters (fail-open), the
 * prompt-injection scan, the shared Gemini kill-switch, and cost logging. It
 * does NOT touch any user quota.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { answerTripQuestion } from "@/lib/ai/concierge-anon";
import type { ItineraryDay } from "@/types";

export const maxDuration = 30;

// Anon abuse limiters. 30/day per IP is generous for an interested browser
// (each Q&A is ~$0.0005) but caps sustained scraping; a short burst cap stops
// rapid-fire re-submits. Both fail-open so a limiter/KV blip never blocks a
// real question.
const conciergeIpLimiter = createRateLimiter("anon-concierge", 30, 24 * 60 * 60 * 1000);
const conciergeBurstLimiter = createRateLimiter("anon-concierge-burst", 5, 60 * 1000);

const BodySchema = z.object({
  question: z.string().trim().min(3).max(500),
  destination: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(160),
  // The itinerary is our own generator's output, re-summarized server-side to a
  // compact text context. Cap the array so an anon caller can't post a huge body.
  days: z.array(z.unknown()).min(1).max(20),
  startDate: z.string().trim().max(10).optional(),
  endDate: z.string().trim().max(10).optional(),
  locale: z.string().trim().max(10).optional(),
});

// Same defense-in-depth injection markers as /api/ai/decide.
const INJECTION_RE =
  /\b(ignore (all |the )?(previous|above|prior)|disregard (the |all )?(above|previous|prior)|system prompt|you are now|forget (everything|your)|new instructions?)\b/i;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errors.badRequest("Body must be valid JSON");
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return errors.badRequest("Invalid concierge payload", {
      issues: parsed.error.issues,
    });
  }
  const body = parsed.data;

  if (INJECTION_RE.test(body.question)) {
    return errors.badRequest(
      "Ask me anything about your trip — places, timing, budget, what to expect."
    );
  }

  // Gemini kill-switch (shared circuit breaker with generation).
  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return errors.serviceUnavailable(
      access.message || "The assistant is taking a short break — try again shortly."
    );
  }

  // Abuse limits — fail-open so a limiter error never blocks a real request.
  const sessionId = request.cookies.get("mt_session_id")?.value || undefined;
  const ipOk = await conciergeIpLimiter
    .check(request)
    .catch(() => ({ allowed: true, remaining: 0 }));
  if (!ipOk.allowed) {
    return errors.rateLimit(
      "You've asked a lot today — sign up (it's free) to keep the assistant going."
    );
  }
  const burstOk = await conciergeBurstLimiter
    .check(request, sessionId)
    .catch(() => ({ allowed: true, remaining: 0 }));
  if (!burstOk.allowed) {
    return errors.rateLimit("One sec — ask that again in a moment.");
  }

  try {
    const result = await answerTripQuestion({
      question: body.question,
      destination: body.destination,
      tripTitle: body.tripTitle,
      days: body.days as ItineraryDay[],
      startDate: body.startDate,
      endDate: body.endDate,
      locale: body.locale,
    });
    void logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/concierge-anon",
      status: 200,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: result.meta.costUsd,
    });
    return apiSuccess({ answer: result.answer });
  } catch (err) {
    console.error("[concierge-anon] error:", err);
    void logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/concierge-anon",
      status: 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: 0,
      error: err instanceof Error ? err.message : "unknown",
    });
    return errors.internal(
      "Couldn't answer that just now — mind trying again?",
      "concierge-anon"
    );
  }
}
