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
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItineraryDay } from "@/types";

// Fire-and-forget observability write (anon_assistant_logs, service-role
// only). The anon assistant is the highest-traffic AI surface but left no
// transcripts — refusal/friction patterns (e.g. the Legoland case in the
// session replays, 2026-07-03 diagnosis) were invisible in our data while
// the authed assistant persists to ai_conversations. Never blocks or fails
// the response.
function logAnonExchange(row: {
  session_id?: string;
  locale?: string;
  destination: string;
  user_message: string;
  reply?: string;
  edit?: unknown;
  error?: string;
}) {
  try {
    const admin = createAdminClient();
    void admin
      .from("anon_assistant_logs")
      .insert(row)
      .then(({ error }) => {
        if (error) {
          console.warn("[assistant-anon] log insert failed:", error.message);
        }
      });
  } catch (e) {
    console.warn(
      "[assistant-anon] log skipped:",
      e instanceof Error ? e.message : e
    );
  }
}

// 60s, not the 30s default: Gemini edit round-trips occasionally exceed 30s
// and were dying as "Vercel Runtime Timeout Error" (17 hits / 14 users in the
// 7 days to 2026-07-18). generate/stream uses 120s; assistant replies are
// smaller, so 60s covers the tail without doubling worst-case compute cost.
export const maxDuration = 60;

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
    logAnonExchange({
      session_id: sessionId,
      locale: body.locale,
      destination: body.destination,
      user_message: body.message,
      reply: result.reply,
      edit: result.edit ?? undefined,
    });
    return apiSuccess({ reply: result.reply, edit: result.edit });
  } catch (err) {
    console.error("[assistant-anon] error:", err);
    logAnonExchange({
      session_id: sessionId,
      locale: body.locale,
      destination: body.destination,
      user_message: body.message,
      error: err instanceof Error ? err.message : "unknown",
    });
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
