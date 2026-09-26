/**
 * POST /api/ai/assistant-anon — Q&A + day-scoped EDIT assistant for the
 * ANONYMOUS generation-result view (pre-save, no auth, no persisted trip).
 *
 * Supersedes /api/ai/concierge-anon (read-only). Same unauthenticated, no-DB
 * model with identical abuse guards (mirrored from the since-retired /api/ai/decide): per-IP +
 * burst limiters (fail-open), prompt-injection scan, shared Gemini kill-switch,
 * cost logging, NO user quota. The client applies any proposed edit to the
 * in-memory itinerary on confirm — the server never mutates anything.
 */
import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { assistTrip } from "@/lib/ai/assistant-anon";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ItineraryDay } from "@/types";

// Fire-and-forget observability write (anon_assistant_logs, service-role
// only). The anon assistant is the highest-traffic AI surface but left no
// transcripts — refusal/friction patterns (e.g. the Legoland case in the
// session replays, 2026-07-03 diagnosis) were invisible in our data while
// the authed assistant persists to ai_conversations. Never blocks or fails
// the response.
//
// waitUntil, not a dangling promise (2026-09-26): the insert used to land only
// if the instance happened to serve another request, so ~15% of turns (23 of
// 156 in 14 days) never reached the table, the monitoring's main lens on it.
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
    waitUntil(
      Promise.resolve(admin.from("anon_assistant_logs").insert(row)).then(({ error }) => {
        if (error) {
          console.warn("[assistant-anon] log insert failed:", error.message);
        }
      })
    );
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
// Signed-in travellers use this same assistant in the wizard, and heavy
// editors send a dozen or more messages a trip (one did 16 in 20 minutes,
// 2026-09-26). They were capped per IP like strangers and told to "sign up
// (it's free)". Their own allowance, keyed by account, with a true message.
const assistUserLimiter = createRateLimiter("assistant-signed-in", 150, 24 * 60 * 60 * 1000);
const assistUserBurstLimiter = createRateLimiter("assistant-signed-in-burst", 12, 60 * 1000);

const BodySchema = z.object({
  // People paste a whole day's plan ("day 3 - Route Quito → Cotopaxi…").
  message: z.string().trim().min(3).max(1500),
  destination: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(160),
  days: z.array(z.unknown()).min(1).max(20),
  startDate: z.string().trim().max(10).optional(),
  endDate: z.string().trim().max(10).optional(),
  locale: z.string().trim().max(10).optional(),
  // The conversation so far, so "yes" and "No I mean…" can be understood.
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(12)
    .optional(),
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
  const userId = await signedInUserId();
  const limited = (reason: string) => {
    // Logged, so a traveller hitting the cap is visible in monitoring.
    waitUntil(
      logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/assistant-anon",
        status: 429,
        responseTimeMs: Date.now() - startedAt,
        cacheHit: false,
        costUsd: 0,
        exactCost: true,
        error: reason,
        userId: userId ?? undefined,
      }).catch(() => undefined)
    );
  };
  if (userId) {
    const dayOk = await assistUserLimiter.check(request, userId).catch(() => ({ allowed: true, remaining: 0 }));
    if (!dayOk.allowed) {
      limited("daily cap (signed in)");
      // "reason" picks the panel's localized message (the text is for logs).
      return errors.rateLimit("Daily assistant limit reached (signed in).", { reason: "daily_user" });
    }
    const burstOk = await assistUserBurstLimiter.check(request, userId).catch(() => ({ allowed: true, remaining: 0 }));
    if (!burstOk.allowed) {
      limited("burst (signed in)");
      return errors.rateLimit("Too many messages in a minute.", { reason: "burst" });
    }
  } else {
    const ipOk = await assistIpLimiter
      .check(request)
      .catch(() => ({ allowed: true, remaining: 0 }));
    if (!ipOk.allowed) {
      limited("daily cap (per IP)");
      return errors.rateLimit("Daily assistant limit reached (per IP).", { reason: "daily_anon" });
    }
    const burstOk = await assistBurstLimiter
      .check(request, sessionId)
      .catch(() => ({ allowed: true, remaining: 0 }));
    if (!burstOk.allowed) {
      limited("burst");
      return errors.rateLimit("Too many messages in a minute.", { reason: "burst" });
    }
  }

  // Both attempts are billed, including a failed pair (non-JSON twice).
  const geminiCost = new GeminiCostMeter();
  try {
    const result = await geminiCost.run(() =>
      assistTrip({
        message: body.message,
        destination: body.destination,
        tripTitle: body.tripTitle,
        days: body.days as ItineraryDay[],
        startDate: body.startDate,
        endDate: body.endDate,
        locale: body.locale,
        history: body.history,
      })
    );
    waitUntil(logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/assistant-anon",
      status: 200,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: geminiCost.usd,
      exactCost: true,
      userId: userId ?? undefined,
    }).catch(() => undefined));
    logAnonExchange({
      session_id: sessionId,
      locale: body.locale,
      destination: body.destination,
      user_message: body.message,
      reply: result.reply,
      // day_number stays the first edited day, so existing queries still read it.
      edit:
        result.edits.length > 0 || result.tripLength !== undefined
          ? {
              day_number: result.edits[0]?.day_number ?? null,
              days: result.edits.map((e) => e.day_number),
              trip_length: result.tripLength ?? null,
            }
          : undefined,
    });
    return apiSuccess({ reply: result.reply, edits: result.edits, tripLength: result.tripLength, edit: result.edit });
  } catch (err) {
    console.error("[assistant-anon] error:", err);
    logAnonExchange({
      session_id: sessionId,
      locale: body.locale,
      destination: body.destination,
      user_message: body.message,
      error: err instanceof Error ? err.message : "unknown",
    });
    waitUntil(logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/assistant-anon",
      status: 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: geminiCost.usd,
      exactCost: true,
      error: err instanceof Error ? err.message : "unknown",
      userId: userId ?? undefined,
    }).catch(() => undefined));
    // The panel shows its own localized text for a 500 (big multi-day asks
    // are the ones that fail, so it suggests one or two days at a time).
    return errors.internal("Assistant request failed.", "assistant-anon");
  }
}

/** The signed-in account, if any. The assistant works for both; this only picks the allowance. */
async function signedInUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}
