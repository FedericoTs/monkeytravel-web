/**
 * Dynamic Gemini Model Router (purpose-based)
 *
 * Picks a Gemini model based on the *purpose* of the call (which endpoint
 * is asking) rather than free-text complexity classification. Centralising
 * here means a single line change in this file rolls cost/quality
 * tradeoffs across the entire app — no hunt-and-replace through 15 routes.
 *
 * Routing matrix:
 *
 *   Purpose                     | Model                  | Why
 *   ----------------------------|------------------------|----------------------------
 *   trip-generation             | gemini-3.5-flash-lite  | Full plans: fast, good pins, no deep reasoning needed
 *   day-regenerate              | gemini-3.5-flash-lite  | Single-day, same writing as a full plan
 *   activity-regenerate         | gemini-2.5-flash-lite  | Single activity, cheapest works
 *   concierge                   | gemini-3.5-flash-lite  | Conversational, needs context
 *   packing-list                | gemini-2.5-flash-lite  | Deterministic list, cheap
 *   email-parser                | gemini-2.5-flash-lite  | Structured extraction, low temp
 *   trip-title                  | gemini-2.5-flash-lite  | One-shot string, cheapest
 *   assistant-optimize          | gemini-3.5-flash-lite  | A pasted multi-day draft mapped onto the trip
 *   assistant-edits             | gemini-3.5-flash-lite  | The assistant's edit engine (wizard + trip page)
 *   assistant-chat              | gemini-3.5-flash-lite  | The trip assistant's reply when the engine gave none
 *   closed-swaps                | gemini-3.6-flash       | An open place for a sight shut on every date of a trip
 *   dinners                     | gemini-3.5-flash-lite  | A real restaurant for a full day the plan left without dinner
 *   transfers                   | gemini-3.5-flash-lite  | How travellers make each hop of a trip through several cities
 *   route-plan                  | gemini-3.5-flash-lite  | The bases of a trip typed as a whole country or region
 *
 * Env override:
 *   GEMINI_MODEL_OVERRIDE — when set, ALL purposes resolve to that model.
 *   Useful for emergencies (pin to a stable model), A/B tests, or local
 *   dev (`GEMINI_MODEL_OVERRIDE=gemini-2.5-flash-lite` to keep costs zero).
 */

import { ThinkingLevel, type ThinkingConfig } from "@/lib/ai/genai-compat";

export type GeminiPurpose =
  | "trip-generation"
  | "day-regenerate"
  | "activity-regenerate"
  | "concierge"
  | "packing-list"
  | "email-parser"
  | "trip-title"
  | "assistant-optimize"
  | "assistant-edits"
  | "assistant-chat"
  | "anchor-import"
  | "request-reading"
  | "closed-swaps"
  | "dinners"
  | "transfers"
  | "route-plan";

export type GeminiModelId =
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-3.8-flash"
  | "gemini-3.6-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.1-flash-lite";

const PURPOSE_TO_MODEL: Record<GeminiPurpose, GeminiModelId> = {
  // 2.5 Flash-Lite is cheaper, but it places pins worse and writes thinner
  // days, so it keeps only the small utility calls below.
  "trip-generation": "gemini-3.5-flash-lite",
  "day-regenerate": "gemini-3.5-flash-lite",
  "activity-regenerate": "gemini-2.5-flash-lite",
  concierge: "gemini-3.5-flash-lite",
  "packing-list": "gemini-2.5-flash-lite",
  "email-parser": "gemini-2.5-flash-lite",
  "trip-title": "gemini-2.5-flash-lite",
  "assistant-optimize": "gemini-3.5-flash-lite",
  "assistant-edits": "gemini-3.5-flash-lite",
  "assistant-chat": "gemini-3.5-flash-lite",
  // Paste-a-plan import (docs/CONSTRAINT_PLANNER_PLAN.md F2): pasted text →
  // a small array of dated commitments. Same shape of work as email-parser,
  // and responseSchema carries the contract, so the cheapest tier is enough.
  "anchor-import": "gemini-2.5-flash-lite",
  // A trip typed into the destination box, read into the wizard's fields: it
  // has to know places and count dates, so the plans' model.
  "request-reading": "gemini-3.5-flash-lite",
  // A place to go instead of a sight shut on every date of a trip: the lite
  // model offers places shut over the same holiday, this one keeps to open
  // ones. Asked only for those sights, so its price barely counts.
  "closed-swaps": "gemini-3.6-flash",
  // A restaurant near the place a day ends at, for a full day the plan left
  // without dinner (lib/ai/dinners.ts): the plans' own model knows them.
  dinners: "gemini-3.5-flash-lite",
  // The way and the ride time of each hop between the cities of a trip
  // (lib/ai/transfer-question.ts): the plans' own model knows them.
  transfers: "gemini-3.5-flash-lite",
  // The bases of a trip typed as a whole country or region, in order with their
  // days (lib/ai/route-plan.ts): the plans' own model knows the usual routes.
  "route-plan": "gemini-3.5-flash-lite",
};

const ALLOWED_OVERRIDES = new Set<string>([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
]);

/**
 * Resolve a Gemini model id for a given purpose.
 *
 * If `process.env.GEMINI_MODEL_OVERRIDE` is set to a known model id, that
 * wins over the purpose map — but unknown values are silently ignored (a
 * typo shouldn't crash trip generation).
 */
export function getModelForPurpose(purpose: GeminiPurpose): GeminiModelId {
  const override = process.env.GEMINI_MODEL_OVERRIDE;
  if (override && ALLOWED_OVERRIDES.has(override)) {
    return override as GeminiModelId;
  }
  return PURPOSE_TO_MODEL[purpose];
}

/**
 * Sibling model for last-resort fallback (UX10X Phase 0.1).
 *
 * A model can fail hard (GoogleGenerativeAI 500/503) while another holds.
 * Retrying the SAME model rides out blips but not model-specific serving
 * outages; the sibling runs on a different pool. A sibling is never a model
 * with a shutdown date. Also used by regenerateSingleDay's final attempt: a
 * parse-failure retry on the same model tends to reproduce the same malformed
 * output, and a different model breaks the loop.
 */
const SIBLING_MODEL: Record<GeminiModelId, GeminiModelId> = {
  "gemini-3.5-flash-lite": "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-flash": "gemini-2.5-flash-lite",
  "gemini-3.8-flash": "gemini-3.6-flash",
  "gemini-3.6-flash": "gemini-3.8-flash",
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
};

export function getSiblingModel(model: GeminiModelId): GeminiModelId {
  return SIBLING_MODEL[model];
}

/**
 * The thinking a model may do: `budget` tokens on 2.5 models, a level on later
 * ones. They can't turn thinking off, and each refuses a level it doesn't
 * have (3.8 Flash has no minimal, 3.5 Flash-Lite takes no budget at all), so
 * "none" is their lowest level.
 */
export function thinkingConfigFor(model: GeminiModelId, budget = 0): ThinkingConfig {
  if (model.startsWith("gemini-2.5-")) return { thinkingBudget: budget };
  if (budget > 0) return { thinkingLevel: ThinkingLevel.LOW };
  return { thinkingLevel: model === "gemini-3.8-flash" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL };
}
