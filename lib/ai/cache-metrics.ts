import { estimateCost } from "@/lib/posthog/llm-analytics";
import { recordGeminiUsage } from "./gemini-cost";

/**
 * Log Gemini response usage metadata for cache monitoring.
 * Tracks implicit caching stats to verify cost savings, and emits a
 * Sentry warning when the rolling cache-hit rate drops below threshold —
 * catches silent prompt-cache regressions early (often caused by adding
 * a non-cacheable prefix like a timestamp at the start of the prompt).
 */
const CACHE_HIT_RATE_WINDOW = 50; // last N calls
const CACHE_HIT_RATE_ALERT_THRESHOLD = 15; // %; below this we emit a warning
const CACHE_HIT_RATE_MIN_SAMPLES = 20; // don't alert until we have a real signal
const CACHE_HIT_RATE_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 alert/hour max

/**
 * Materiality gate: a low hit rate alerts only when the projected annual waste
 * also clears this bar. Implicit caching does not engage on generateItinerary's
 * prefix even though buildStaticChatHistory keeps it byte-identical, so a 0%
 * rate there is not a regression; and caching discounts only input tokens, a
 * small share of a call's cost. An alert over a rounding error burns the
 * attention a real regression needs.
 */
const CACHE_ALERT_MIN_ANNUAL_USD = 50;

/**
 * Minimum wall-clock span the rolling window must cover before its call rate is
 * treated as representative.
 *
 * Without this, annualising from the window's own span inflates wildly on a
 * burst: 20 calls arriving in 10 seconds project (miss / 10s) x 1 year and
 * would fire the alert on a trickle of real traffic. You cannot infer an annual
 * rate from ten seconds. Below this span the projection is skipped entirely
 * rather than guessed at.
 */
const CACHE_ALERT_MIN_OBSERVATION_MS = 30 * 60 * 1000; // 30 minutes

/** Samples keep a timestamp + priced miss so waste can be annualised. */
type CacheSample = { pct: number; ts: number; missedUsd: number };

/**
 * Gemini implicit caching only engages once the prompt clears a model-specific
 * floor (1,024 tokens on the 2.5 Flash tier, 2,048 on Pro). Below it,
 * `cachedContentTokenCount` is ALWAYS 0 — no prompt reordering can change
 * that — so small-prompt endpoints (e.g. ai.assistant-anon) would make the
 * rolling average a permanent false alarm. Skip them.
 */
const CACHE_MIN_ELIGIBLE_PROMPT_TOKENS = 1024;

// One window per endpoint, keyed by the label callers pass in: a pooled
// average lets a high-traffic endpoint fake a cache regression, or hide a real
// one on a big-prompt endpoint (trip generation).
const cacheHitRolling = new Map<string, CacheSample[]>(); // endpoint -> samples
const lastCacheAlertAt = new Map<string, number>();

/**
 * Exported so every API route that calls Gemini wires the same rolling
 * cache-hit metric instead of reinventing its own or skipping it.
 *
 * Call this AFTER any `model.generateContent(...)` /
 * `model.generateContentStream(...)` and pass `response.usageMetadata`
 * along with a stable route label (e.g. "concierge", "assistant.new_activity").
 *
 * Call it exactly once per response: it is also what adds the response's cost
 * to the request's GeminiCostMeter (lib/ai/gemini-cost.ts), the figure the
 * routes log to api_request_logs.
 */
export function logCacheMetrics(
  endpoint: string,
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  },
  /** Model id: prices the response, and the materiality gate's miss.
   *  Optional: callers that omit it fall back to the main model's price. */
  model: string = "gemini-3.5-flash-lite"
) {
  if (!usageMetadata) return;

  recordGeminiUsage(model, usageMetadata);

  const {
    promptTokenCount = 0,
    candidatesTokenCount = 0,
    cachedContentTokenCount = 0,
  } = usageMetadata;

  const cacheHitRatePct =
    promptTokenCount > 0 ? (cachedContentTokenCount / promptTokenCount) * 100 : 0;

  console.log(
    `[Gemini Cache] ${endpoint}: ` +
      `prompt=${promptTokenCount}, output=${candidatesTokenCount}, ` +
      `cached=${cachedContentTokenCount} (${cacheHitRatePct.toFixed(1)}% cache hit)`
  );

  // Calculate cost savings (cached tokens are 75% cheaper)
  if (cachedContentTokenCount > 0) {
    const regularCost = cachedContentTokenCount * 0.00001; // $0.01 per 1K tokens
    const cachedCost = cachedContentTokenCount * 0.0000025; // $0.0025 per 1K cached tokens
    const savings = regularCost - cachedCost;
    console.log(`[Gemini Cache] Savings: $${savings.toFixed(6)} from cached tokens`);
  }

  // Rolling cache-hit-rate alerting — per endpoint, and only for calls whose
  // prompt is large enough for implicit caching to engage at all.
  if (promptTokenCount >= CACHE_MIN_ELIGIBLE_PROMPT_TOKENS) {
    // Upper bound on what caching could have saved on THIS call: price every
    // uncached prompt token as if it could have been served from cache. If even
    // that optimistic figure is immaterial, the alert is not worth sending.
    const uncached = Math.max(0, promptTokenCount - cachedContentTokenCount);
    const missedUsd =
      estimateCost(model, promptTokenCount, 0, cachedContentTokenCount) -
      estimateCost(model, promptTokenCount, 0, cachedContentTokenCount + uncached);

    const series = cacheHitRolling.get(endpoint) ?? [];
    series.push({ pct: cacheHitRatePct, ts: Date.now(), missedUsd });
    cacheHitRolling.set(
      endpoint,
      series.length > CACHE_HIT_RATE_WINDOW
        ? series.slice(-CACHE_HIT_RATE_WINDOW)
        : series
    );

    const window = cacheHitRolling.get(endpoint)!;
    if (window.length >= CACHE_HIT_RATE_MIN_SAMPLES) {
      const avg = window.reduce((a, b) => a + b.pct, 0) / window.length;
      const now = Date.now();

      // Annualise the observed waste from the window's own call rate, so the
      // projection reflects real traffic rather than an assumed volume.
      const spanMs = now - window[0].ts;
      const missedInWindow = window.reduce((a, b) => a + b.missedUsd, 0);
      // Only project once the window covers enough wall-clock to be a rate.
      const projectedAnnualUsd =
        spanMs >= CACHE_ALERT_MIN_OBSERVATION_MS
          ? (missedInWindow / spanMs) * 365 * 24 * 60 * 60 * 1000
          : 0;

      if (
        avg < CACHE_HIT_RATE_ALERT_THRESHOLD &&
        projectedAnnualUsd >= CACHE_ALERT_MIN_ANNUAL_USD &&
        now - (lastCacheAlertAt.get(endpoint) ?? 0) >
          CACHE_HIT_RATE_ALERT_COOLDOWN_MS
      ) {
        lastCacheAlertAt.set(endpoint, now);
        // State what was measured; do not assert a cause: a guessed cause
        // sends the investigation down the wrong path.
        const msg =
          `[Gemini Cache] ${endpoint}: cache-hit rate ${avg.toFixed(1)}% over ` +
          `${window.length} eligible calls (threshold ${CACHE_HIT_RATE_ALERT_THRESHOLD}%), ` +
          `projecting ~$${projectedAnnualUsd.toFixed(0)}/year of avoidable input cost ` +
          `on ${model}. Worth investigating at this size. Check, in order: is the ` +
          `leading history block byte-identical across calls; is the shared prefix ` +
          `comfortably above the model's implicit-cache floor ` +
          `(${CACHE_MIN_ELIGIBLE_PROMPT_TOKENS}+ tokens); are consecutive calls close ` +
          `enough together to land in the same cache window.`;
        console.warn(msg);
        // Best-effort Sentry capture — wrapped so a missing/failed Sentry
        // never breaks the Gemini call path. Imported lazily so the
        // dependency stays optional.
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.captureMessage?.(msg, "warning");
          })
          .catch(() => {
            /* Sentry not available — console.warn above is the fallback */
          });
      }
    }
  }
}
