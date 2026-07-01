/**
 * POST /api/ai/decide — decision-first front door "propose options" step.
 * Plan: docs/DECISION_FRONT_DOOR_PLAN.md
 *
 * Free-text trip prompt → 2-3 destination/trip-shape proposals. Cheap Flash-Lite
 * call, NO Google Places (destinations are just strings until the user picks +
 * generates), so it preserves the Places-only-on-save cost model.
 *
 * Rate-limiting: deliberately does NOT consume the 2/day generation quota (that
 * budget is for the real itinerary — a user should be able to browse ideas
 * cheaply). Own per-IP + per-session burst limiters instead, both fail-open so a
 * limiter/KV blip can never block a real request.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { generateProposals } from "@/lib/ai/decide";

export const maxDuration = 30;

// Anon abuse limiters. Higher IP ceiling than anon-generate (40) because decide
// is ~10x cheaper (~$0.0004 vs ~$0.003) and a browsing user may try several
// prompts; plus a short per-session burst cap against rapid re-submits.
const decideIpLimiter = createRateLimiter("anon-decide", 60, 24 * 60 * 60 * 1000);
const decideBurstLimiter = createRateLimiter("anon-decide-burst", 10, 60 * 1000);

const BodySchema = z.object({
  prompt: z.string().trim().min(3).max(500),
  month: z.string().trim().max(20).optional(),
  nights: z.number().int().min(1).max(14).optional(),
  budgetHint: z.enum(["budget", "balanced", "premium"]).optional(),
  travelStyle: z.enum(["classic", "backpacker"]).optional(),
  origin: z.string().trim().max(80).optional(),
  // UI locale so proposals come back in the traveller's language (keeps the
  // A/B fair for it/es/pt). Lenient string — decide.ts maps unknown → English,
  // so a region variant (e.g. "en-US") never 400s the whole call.
  locale: z.string().trim().max(10).optional(),
});

// Obvious prompt-injection markers. Defense-in-depth: the model is also
// constrained by its instruction, and the picked destination is re-validated at
// /api/ai/generate (validateTripParams is the real security boundary).
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
    return errors.badRequest("Invalid decide payload", {
      issues: parsed.error.issues,
    });
  }
  const body = parsed.data;

  if (INJECTION_RE.test(body.prompt)) {
    return errors.badRequest(
      "Tell me about the trip you want — a place, a vibe, a budget, or some dates."
    );
  }

  // Gemini kill-switch (shared circuit breaker with generation).
  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return errors.serviceUnavailable(
      access.message || "Trip ideas are temporarily unavailable — try again shortly."
    );
  }

  // Abuse limits — fail-open so a limiter error never blocks a real request.
  const sessionId = request.cookies.get("mt_session_id")?.value || undefined;
  const ipOk = await decideIpLimiter
    .check(request)
    .catch(() => ({ allowed: true, remaining: 0 }));
  if (!ipOk.allowed) {
    return errors.rateLimit(
      "You've explored a lot of ideas today — sign up to keep going, it's free."
    );
  }
  const burstOk = await decideBurstLimiter
    .check(request, sessionId)
    .catch(() => ({ allowed: true, remaining: 0 }));
  if (!burstOk.allowed) {
    return errors.rateLimit("One sec — try that again in a moment.");
  }

  try {
    const result = await generateProposals(body);
    void logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/decide",
      status: 200,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: result.meta.costUsd,
    });
    return apiSuccess(result);
  } catch (err) {
    console.error("[decide] error:", err);
    void logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/decide",
      status: 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: 0,
      error: err instanceof Error ? err.message : "unknown",
    });
    return errors.internal(
      "Couldn't come up with ideas just now — mind trying again?",
      "decide"
    );
  }
}
