/**
 * Dynamic Gemini Model Router (purpose-based)
 *
 * Picks a Gemini model based on the *purpose* of the call (which endpoint
 * is asking) rather than free-text complexity classification. Centralising
 * here means a single line change in this file rolls cost/quality
 * tradeoffs across the entire app — no hunt-and-replace through 15 routes.
 *
 * Routing matrix (set per the 2026-05-31 API optimization audit):
 *
 *   Purpose                     | Model                  | Why
 *   ----------------------------|------------------------|----------------------------
 *   trip-generation             | gemini-2.5-flash       | 2.5-pro thinking blew 30s timeout; flash supports thinkingBudget=0
 *   day-regenerate              | gemini-2.5-flash       | Single-day, balanced quality/cost
 *   activity-regenerate         | gemini-2.5-flash-lite  | Single activity, cheapest works
 *   concierge                   | gemini-2.5-flash       | Conversational, needs context
 *   packing-list                | gemini-2.5-flash-lite  | Deterministic list, cheap
 *   email-parser                | gemini-2.5-flash-lite  | Structured extraction, low temp
 *   photo-extract               | gemini-2.5-flash       | Multimodal vision required
 *   trip-title                  | gemini-2.5-flash-lite  | One-shot string, cheapest
 *   activity-bank               | gemini-2.5-flash       | Batch list generation
 *   mcp-trip                    | gemini-2.5-flash       | External MCP/ChatGPT endpoint
 *   maps-grounding              | gemini-2.5-flash       | Needs grounding model support
 *   assistant-suggest           | gemini-2.5-flash       | Activity suggestion w/ caching
 *   assistant-optimize          | gemini-2.5-flash       | Day optimisation w/ caching
 *   generate-more-days          | gemini-2.5-flash       | Continuation, multi-day
 *
 * Env override:
 *   GEMINI_MODEL_OVERRIDE — when set, ALL purposes resolve to that model.
 *   Useful for emergencies (pin to a stable model), A/B tests, or local
 *   dev (`GEMINI_MODEL_OVERRIDE=gemini-2.5-flash-lite` to keep costs zero).
 */

export type GeminiPurpose =
  | "trip-generation"
  | "day-regenerate"
  | "activity-regenerate"
  | "concierge"
  | "packing-list"
  | "email-parser"
  | "photo-extract"
  | "trip-title"
  | "activity-bank"
  | "mcp-trip"
  | "maps-grounding"
  | "assistant-suggest"
  | "assistant-optimize"
  | "generate-more-days";

export type GeminiModelId =
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite";

const PURPOSE_TO_MODEL: Record<GeminiPurpose, GeminiModelId> = {
  // 2026-06-01 P0 ROOT-CAUSE FIX: switched from gemini-2.5-pro → 2.5-flash.
  //
  // The fresh Google AI key worked in direct REST test against pro
  // (returned 200 OK in 14s for a 1-char prompt → 1433 *thoughts*
  // tokens). For a real itinerary prompt (1500+ input, 6000 output
  // cap), default thinking consistently blew past
  // AI_REQUEST_TIMEOUT_MS (30s) → every attempt timed out, route
  // returned 500 after retries (Sentry 123983732).
  //
  // We CAN'T disable thinking on pro — direct REST test with
  // `thinkingConfig: { thinkingBudget: 0 }` returned 400
  // "Budget 0 is invalid. This model only works in thinking mode."
  //
  // Flash DOES support thinkingBudget=0 (REST test returned in
  // 0.88s flat). Same family, comparable JSON output quality for
  // structured itineraries, 5-10× cheaper. The `thinkingConfig`
  // line in lib/gemini.ts now safely takes effect.
  "trip-generation": "gemini-2.5-flash",
  "day-regenerate": "gemini-2.5-flash",
  "activity-regenerate": "gemini-2.5-flash-lite",
  concierge: "gemini-2.5-flash",
  "packing-list": "gemini-2.5-flash-lite",
  "email-parser": "gemini-2.5-flash-lite",
  "photo-extract": "gemini-2.5-flash",
  "trip-title": "gemini-2.5-flash-lite",
  "activity-bank": "gemini-2.5-flash",
  "mcp-trip": "gemini-2.5-flash",
  "maps-grounding": "gemini-2.5-flash",
  "assistant-suggest": "gemini-2.5-flash",
  "assistant-optimize": "gemini-2.5-flash",
  "generate-more-days": "gemini-2.5-flash",
};

const ALLOWED_OVERRIDES = new Set<string>([
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]);

/**
 * Resolve a Gemini model id for a given purpose.
 *
 * If `process.env.GEMINI_MODEL_OVERRIDE` is set to a known Gemini 2.5
 * model id, that wins over the purpose map — but unknown values are
 * silently ignored (a typo shouldn't crash trip generation).
 */
export function getModelForPurpose(purpose: GeminiPurpose): GeminiModelId {
  const override = process.env.GEMINI_MODEL_OVERRIDE;
  if (override && ALLOWED_OVERRIDES.has(override)) {
    return override as GeminiModelId;
  }
  return PURPOSE_TO_MODEL[purpose];
}

/**
 * Build a URL-safe Gemini REST endpoint for a given purpose.
 * Used by the maps-grounding path which still calls the REST API
 * directly (the SDK doesn't expose grounding tools at the time of
 * writing).
 */
export function getModelEndpointForPurpose(
  purpose: GeminiPurpose,
  method: "generateContent" | "streamGenerateContent" = "generateContent"
): string {
  const model = getModelForPurpose(purpose);
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
}
