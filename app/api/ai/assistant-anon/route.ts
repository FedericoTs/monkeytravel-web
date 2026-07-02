/**
 * POST /api/ai/assistant-anon — Q&A + day-scoped EDIT assistant for the
 * ANONYMOUS generation-result view (pre-save, no auth, no persisted trip).
 *
 * Supersedes /api/ai/concierge-anon (read-only). Same unauthenticated, no-DB
 * model with identical abuse guards (mirrored from /api/ai/decide): per-IP +
 * burst limiters (fail-open), prompt-injection scan, shared Gemini kill-switch,
 * cost logging, NO user quota. The client applies any proposed edit to the
 * in-memory itinerary on confirm — the server never mutates anything.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { assistTrip } from "@/lib/ai/assistant-anon";
import type { ItineraryDay } from "@/types";

export const maxDuration = 30;

// Anon abuse limiters. Slightly tighter per-IP than the read-only concierge
// because an edit round-trip is a bit pricier (~$0.0006) and produces content.
const assistIpLimiter = createRateLimiter("anon-assistant", 30, 24 * 60 * 60 * 1000);
const assistBurstLimiter = createRateLimiter("anon-assistant-burst", 5, 60 * 1000);

const BodySchema = z.object({
  message: z.string().trim().min(3).max(500),
  destination: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(160),
  days: z.array(z.unknown()).min(1).max(20),
  startDate: z.string().trim().max(10).optional(),
  endDate: z.string().trim().max(10).optional(),
  locale: z.string().trim().max(10).optional(),
});

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
    return errors.badRequest("Invalid assistant payload", { issues: parsed.error.issues });
  }
  const body = parsed.data;

  if (INJECTION_RE.test(body.message)) {
    return errors.badRequest(
      "Ask me anything about your trip, or tell me what you'd like to change."
    );
  }

  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return errors.serviceUnavailable(
      access.message || "The assistant is taking a short break — try again shortly."
    );
  }

  const sessionId = request.cookies.get("mt_session_id")?.value || undefined;
  const ipOk = await assistIpLimiter
    .check(request)
    .catch(() => ({ allowed: true, remaining: 0 }));
  if (!ipOk.allowed) {
    return errors.rateLimit(
      "You've done a lot today — sign up (it's free) to keep the assistant going."
    );
  }
  const burstOk = await assistBurstLimiter
    .check(request, sessionId)
    .catch(() => ({ allowed: true, remaining: 0 }));
  if (!burstOk.allowed) {
    return errors.rateLimit("One sec — try that again in a moment.");
  }

  try {
    const result = await assistTrip({
      message: body.message,
      destination: body.destination,
      tripTitle: body.tripTitle,
      days: body.days as ItineraryDay[],
      startDate: body.startDate,
      endDate: body.endDate,
      locale: body.locale,
    });
    void logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/assistant-anon",
      status: 200,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: result.meta.costUsd,
    });
    return apiSuccess({ reply: result.reply, edit: result.edit });
  } catch (err) {
    console.error("[assistant-anon] error:", err);
    void logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/assistant-anon",
      status: 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: 0,
      error: err instanceof Error ? err.message : "unknown",
    });
    return errors.internal("Couldn't do that just now — mind trying again?", "assistant-anon");
  }
}
