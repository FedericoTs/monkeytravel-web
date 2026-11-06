import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { blockedCall, checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { withinAnonDailyLimit } from "@/lib/ai/anon-daily-limit";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import { recordAiOutcome } from "@/lib/ai/observability";
import { checkExtractRateLimit, recordExtract } from "@/lib/anonymous/rate-limit-extract";
import { createClient } from "@/lib/supabase/server";
import { extractPlan, isPlanExtractError } from "@/lib/ai/anchor-import";
import { normalizeImportedAnchors } from "@/lib/ai/anchor-import-core";
import { MAX_ANCHORED_TRIP_DAYS, assertISODate, inclusiveDaySpan } from "@/lib/ai/anchors-core";
import { readJsonBody } from "@/lib/api/json-body";
import { createRateLimiter } from "@/lib/api/rate-limit";

// Per account, or per network for someone signed out, since the cookie budget
// resets with the cookie.
const limiter = createRateLimiter("import-plan", 40, 24 * 60 * 60 * 1000);

/**
 * POST /api/ai/import-plan
 *
 * Paste-a-plan (F2 of docs/CONSTRAINT_PLANNER_PLAN.md). The traveller
 * pastes the plan they already half-made; we return anchors the wizard can
 * drop straight into the anchor panel, so generation fills the GAPS rather
 * than replacing their work.
 *
 * Two-stage by design: Gemini extracts loosely (lib/ai/anchor-import), then
 * normalizeImportedAnchors() enforces the hard guarantee that the result
 * passes validateAnchors(). Nothing the model emits is trusted — items that
 * would conflict come back in `dropped` with a reason, never as an error.
 *
 * Cost: ZERO Google Places spend (plan §6). One flash-lite text call. The
 * anchor `location` stays free text; no geocoding happens here or later.
 *
 * Auth: optional. Anonymous callers share the mt_anon_extract budget with
 * Start Anywhere (10 per 24h) — same class of operation, no new cookie.
 *
 * Request body:
 *   {
 *     "text": "Day 1 land in Venice 09:40, Sep 11 night in Trieste, ...",
 *     "startDate": "2026-09-08",
 *     "endDate": "2026-09-15",
 *     "destination": "Venice, Italy"   // optional, model context only
 *   }
 *
 * Response 200:
 *   {
 *     "anchors":  TripAnchor[],                            // ready to use
 *     "dropped":  [{ "title": "...", "reason": "duplicate" }],
 *     "undated":  ["Uffizi at some point"]                  // → requirements box
 *   }
 *
 * Response 400: bad body / bad dates / range too long, or too little or nothing
 *               plan-like in the text (carries `reason`: "too_short", "nothing_found")
 * Response 429: anonymous extraction budget exhausted, or too many imports today
 * Response 503: Gemini failed, or its kill switch or daily limit said no
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  // What the Gemini call cost, from its tokens (lib/ai/gemini-cost.ts).
  const geminiCost = new GeminiCostMeter();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isAnonymous = user === null;

    if (isAnonymous) {
      const limit = await checkExtractRateLimit();
      if (!limit.allowed) {
        return errors.rateLimit(
          "You've used your free plan imports for today. Sign up to keep importing plans.",
          { usage: limit, signupUrl: "/auth/signup" }
        );
      }
    }

    const { allowed } = await limiter.check(request, user?.id);
    if (!allowed) {
      return errors.rateLimit("You've imported a lot of plans today. Try again tomorrow.");
    }

    const { body, invalidBody } = await readJsonBody<Record<string, unknown>>(request);
    if (invalidBody) return invalidBody;

    const text = typeof body.text === "string" ? body.text : "";
    const startDate = typeof body.startDate === "string" ? body.startDate : "";
    const endDate = typeof body.endDate === "string" ? body.endDate : "";
    const destination =
      typeof body.destination === "string" ? body.destination.slice(0, 120) : undefined;

    if (!text.trim()) {
      return errors.badRequest("text is required");
    }

    // Dates come from the wizard, but a hand-rolled client could send
    // anything — and assertISODate THROWS, so validate before the model call
    // rather than letting a bad date surface as a 500 after we've paid for
    // a generation.
    let totalDays: number;
    try {
      assertISODate(startDate, "startDate");
      assertISODate(endDate, "endDate");
      totalDays = inclusiveDaySpan(startDate, endDate);
    } catch {
      return errors.badRequest("startDate and endDate must be valid ISO dates (YYYY-MM-DD)");
    }
    if (totalDays < 1) {
      return errors.badRequest("endDate must not be before startDate");
    }
    if (totalDays > MAX_ANCHORED_TRIP_DAYS) {
      return errors.badRequest(
        `Anchored trips are limited to ${MAX_ANCHORED_TRIP_DAYS} days`
      );
    }

    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      return blockedCall(access, {
        apiName: "gemini",
        endpoint: "/api/ai/import-plan",
        startTime,
        metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
        disabled: "Importing a plan is currently disabled",
      });
    }
    if (isAnonymous && !(await withinAnonDailyLimit())) {
      return errors.rateLimit("We've reached today's limit for free imports. Sign up to keep going — it's free.", {
        signupUrl: "/auth/signup",
      });
    }

    const extracted = await geminiCost.run(() =>
      extractPlan(text, {
        startDate,
        endDate,
        totalDays,
        destination,
      })
    );

    if (isPlanExtractError(extracted)) {
      const durationMs = Date.now() - startTime;
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/import-plan",
        status: extracted.error === "extract_failed" || extracted.error === "model_outage" ? 503 : 400,
        responseTimeMs: durationMs,
        cacheHit: false,
        costUsd: geminiCost.usd,
        exactCost: true,
        error: extracted.error,
        metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
      });

      if (extracted.error === "model_outage") return errors.modelOutage();
      if (extracted.error === "too_short") {
        return errors.badRequest("Paste a bit more — we couldn't find a plan in that.", { reason: "too_short" });
      }
      if (extracted.error === "nothing_found") {
        // Not a server error: the request was well-formed, the content just
        // had no plan in it. The model still read it, so it counts.
        if (isAnonymous) await recordExtract();
        return errors.badRequest(
          "We couldn't find any dated plans in that text. Try including days or dates.",
          { reason: "nothing_found" }
        );
      }
      return errors.serviceUnavailable(
        "Couldn't read that plan right now. Try again in a moment."
      );
    }

    // THE trust boundary — everything past this point is guaranteed to
    // satisfy validateAnchors(), so the wizard can send it straight to
    // /api/ai/generate without risking a 400 that loses the paste.
    const { anchors, dropped } = normalizeImportedAnchors(extracted.items, {
      startDate,
      endDate,
      idPrefix: "imp",
    });

    if (isAnonymous) {
      await recordExtract();
    }

    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/import-plan",
      status: 200,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: geminiCost.usd,
      exactCost: true,
      metadata: {
        user_id: user?.id ?? "anonymous",
        is_anonymous: isAnonymous,
        text_length: text.length,
        trip_days: totalDays,
        extracted_count: extracted.items.length,
        anchor_count: anchors.length,
        dropped_count: dropped.length,
        undated_count: extracted.undated.length,
      },
    });

    return apiSuccess({ anchors, dropped, undated: extracted.undated });
  } catch (err) {
    console.error("[import-plan] Unexpected error:", err);

    void recordAiOutcome({
      endpoint: "import-plan",
      outcome: "failure",
      durationMs: Date.now() - startTime,
      error: err,
    });

    return errors.internal("Couldn't read that plan right now. Try again in a moment.", "ImportPlan");
  }
}
