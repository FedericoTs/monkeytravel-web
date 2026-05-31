/**
 * AI endpoint observability.
 *
 * Why this exists (task #223, 2026-05-30): every AI route (/api/ai/generate,
 * /api/ai/regenerate-activity, /api/ai/assistant, …) had a catch block that
 * console.error'd + wrote a row to api_calls_log and returned a 500. None
 * of them captured to Sentry. So when Gemini timed out, rate-limited, or
 * returned a malformed JSON, the failure was invisible to alerting — we'd
 * only notice when a user complained or someone scanned the DB by hand.
 *
 * This module wraps the existing logApiCall flow with a Sentry capture so
 * AI failures fire alerts and show up in dashboards. It also emits a
 * structured success breadcrumb so we can correlate failures against the
 * traffic baseline (success-rate calculation needs both numerator and
 * denominator).
 *
 * Design constraints:
 * - Never throw. Observability that breaks the request path is worse than
 *   no observability. Every call is wrapped in try/catch with a console
 *   fallback if Sentry import fails.
 * - Sentry SDK is imported dynamically. The Next.js server runtime
 *   already loads @sentry/nextjs once via instrumentation-server.ts, so
 *   the dynamic import resolves from the module cache after first hit —
 *   no extra cost. The pattern matches lib/analytics.ts for the
 *   client-side helpers, kept here for consistency.
 * - Tags are normalized so PostHog/Sentry dashboards can group by them
 *   without per-endpoint string munging:
 *     ai.endpoint:    short string like "generate", "regenerate-activity"
 *     ai.outcome:     "success" | "failure"
 *     ai.model:       "gemini-2.5-flash-lite" | "maps-grounding" | "cache"
 *     ai.cache_hit:   "true" | "false"
 *     ai.duration_ms: numeric
 *   Errors get the actual exception so source-map symbolication works.
 */

export type AiOutcome = "success" | "failure";

/**
 * Short, dashboard-friendly identifier for an AI endpoint. Don't include
 * the leading "/api/ai/" — keep it tight so groupings stay readable.
 */
export type AiEndpoint =
  | "generate"
  | "generate-more-days"
  | "regenerate-activity"
  | "regenerate-day"
  | "assistant"
  | "extract-trip-context"
  | "packing-list"
  | "start-anywhere";

/**
 * Model identifier — what produced the result. "cache" when we served
 * from cross-user cache without calling any model. "maps-grounding" for
 * the Gemini-with-Maps variant. "n/a" when the failure happened before
 * we even chose a model (e.g. validation 400, auth 401).
 */
export type AiModel =
  | "cache"
  | "maps-grounding"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "n/a";

export interface AiOutcomeInput {
  endpoint: AiEndpoint;
  outcome: AiOutcome;
  model?: AiModel;
  cacheHit?: boolean;
  durationMs: number;
  /** Authenticated user id, or null/undefined for anonymous. */
  userId?: string | null;
  /** The error if outcome === "failure". Unused on success. */
  error?: unknown;
  /** Extra context for the Sentry event (destination, prompt length, etc). */
  metadata?: Record<string, unknown>;
}

/**
 * Record one AI endpoint outcome.
 *
 * On success: emits a Sentry breadcrumb (no event spend, but visible in
 * the trail of any later event from the same trace). On failure:
 * captures an exception with normalized tags + context.
 *
 * Returns nothing — caller's request flow must not depend on this.
 */
export async function recordAiOutcome(input: AiOutcomeInput): Promise<void> {
  const {
    endpoint,
    outcome,
    model = "n/a",
    cacheHit = false,
    durationMs,
    userId,
    error,
    metadata,
  } = input;

  // Structured console log — Vercel log search can grep on the prefix.
  // Keep this BEFORE the Sentry import so we always get a record even if
  // the SDK is unavailable (e.g. local dev without DSN).
  const logShape = {
    msg: "[ai-observability]",
    endpoint,
    outcome,
    model,
    cache_hit: cacheHit,
    duration_ms: durationMs,
    user: userId ?? "anonymous",
    ...(metadata ?? {}),
  };
  if (outcome === "success") {
    console.log("[ai-observability]", JSON.stringify(logShape));
  } else {
    // Use console.error so the line shows up in the error tier of Vercel
    // log filtering even if Sentry capture fails below.
    console.error(
      "[ai-observability]",
      JSON.stringify({
        ...logShape,
        error_message:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "unknown",
      })
    );
  }

  // Sentry path — wrapped in try/catch because dynamic import can fail
  // (no DSN configured, network error fetching the SDK chunk, etc) and
  // we never want observability to break the request flow.
  try {
    const Sentry = await import("@sentry/nextjs");

    if (outcome === "success") {
      // Breadcrumbs are cheap (no event quota) and give every subsequent
      // Sentry event in the same trace a visible trail of recent AI
      // calls. Crucial for debugging "the page rendered weird AFTER a
      // successful regenerate" type issues.
      Sentry.addBreadcrumb({
        category: "ai",
        message: `${endpoint} ok`,
        level: "info",
        data: {
          endpoint,
          model,
          cache_hit: cacheHit,
          duration_ms: durationMs,
          ...(metadata ?? {}),
        },
      });
      return;
    }

    // Failure path — capture as an actual exception so it counts toward
    // the error rate dashboard + triggers alert rules.
    const captureContext: Record<string, unknown> = {
      tags: {
        "ai.endpoint": endpoint,
        "ai.outcome": "failure",
        "ai.model": model,
        "ai.cache_hit": String(cacheHit),
      },
      contexts: {
        ai: {
          endpoint,
          model,
          cache_hit: cacheHit,
          duration_ms: durationMs,
          ...(metadata ?? {}),
        },
      },
    };
    if (userId) {
      captureContext.user = { id: userId };
    }

    if (error instanceof Error) {
      Sentry.captureException(error, captureContext);
    } else {
      // Synthesize an error so Sentry still groups it sanely. Includes
      // the endpoint in the message so the grouper doesn't collapse
      // unrelated failures into one issue.
      const synth = new Error(
        `AI ${endpoint} failed: ${
          typeof error === "string" ? error : "unknown error"
        }`
      );
      Sentry.captureException(synth, captureContext);
    }
  } catch (sentryErr) {
    // Last-resort log so we know observability itself broke.
    console.error("[ai-observability] Sentry capture failed:", sentryErr);
  }
}
