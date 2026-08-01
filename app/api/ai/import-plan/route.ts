import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { logApiCall } from "@/lib/api-gateway";
import { recordAiOutcome } from "@/lib/ai/observability";
import { checkExtractRateLimit, recordExtract } from "@/lib/anonymous/rate-limit-extract";
import { createClient } from "@/lib/supabase/server";
import { extractPlan, isPlanExtractError } from "@/lib/ai/anchor-import";
import { normalizeImportedAnchors } from "@/lib/ai/anchor-import-core";
import { MAX_ANCHORED_TRIP_DAYS, assertISODate, inclusiveDaySpan } from "@/lib/ai/anchors-core";

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
 * Response 400: bad body / bad dates / range too long, or nothing plan-like
 *               found in the text (carries `reason: "nothing_found"`)
 * Response 429: anonymous extraction budget exhausted
 * Response 503: Gemini failed
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Body must be valid JSON");
    }

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

    const extracted = await extractPlan(text, {
      startDate,
      endDate,
      totalDays,
      destination,
    });

    if (isPlanExtractError(extracted)) {
      const durationMs = Date.now() - startTime;
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/import-plan",
        status: extracted.error === "extract_failed" ? 503 : 400,
        responseTimeMs: durationMs,
        cacheHit: false,
        costUsd: 0,
        error: extracted.error,
        metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
      });

      if (extracted.error === "too_short") {
        return errors.badRequest("Paste a bit more — we couldn't find a plan in that.");
      }
      if (extracted.error === "nothing_found") {
        // Not a server error: the request was well-formed, the content just
        // had no plan in it. `reason` lets the UI keep the user's text and
        // show a hint instead of treating this as a failure.
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
      costUsd: 0.0002, // flash-lite, one short structured call
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
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[import-plan] Unexpected error:", message);

    void recordAiOutcome({
      endpoint: "import-plan",
      outcome: "failure",
      durationMs: Date.now() - startTime,
      error: err,
    });

    return errors.internal(message, "ImportPlan");
  }
}
