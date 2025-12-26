/**
 * PostHog LLM Analytics
 *
 * Captures $ai_generation events for tracking:
 * - Token usage (input/output/cached)
 * - Costs (with cache discount)
 * - Latency
 * - Model performance
 *
 * Uses PostHog's official LLM analytics schema:
 * https://posthog.com/docs/ai-engineering/observability
 */

import { captureServerEvent } from "./server";

/**
 * Gemini model pricing (as of 2025)
 * Prices in USD per 1M tokens
 */
const MODEL_PRICING = {
  "gemini-2.5-flash-lite": {
    input: 0.075,        // $0.075 per 1M input tokens
    output: 0.30,        // $0.30 per 1M output tokens
    cachedInput: 0.01875, // 75% discount for cached tokens
  },
  "gemini-2.5-flash": {
    input: 0.15,
    output: 0.60,
    cachedInput: 0.0375,
  },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 5.00,
    cachedInput: 0.3125,
  },
} as const;

type GeminiModel = keyof typeof MODEL_PRICING;

/**
 * Usage metadata from Gemini API response
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * Parameters for capturing LLM generation event
 */
export interface LLMGenerationParams {
  /** User ID for attribution (or 'anonymous') */
  distinctId: string;
  /** Model used (e.g., 'gemini-2.5-flash-lite') */
  model: string;
  /** Function/endpoint name (e.g., 'generateItinerary') */
  endpoint: string;
  /** Gemini usage metadata from response */
  usageMetadata?: GeminiUsageMetadata;
  /** Request latency in milliseconds */
  latencyMs: number;
  /** Whether the request succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional properties */
  properties?: Record<string, unknown>;
}

/**
 * Calculate cost for Gemini API call
 * Accounts for cached token discount (75% cheaper)
 */
function calculateCost(
  model: string,
  usageMetadata?: GeminiUsageMetadata
): number {
  if (!usageMetadata) return 0;

  const pricing = MODEL_PRICING[model as GeminiModel];
  if (!pricing) {
    console.warn(`[LLM Analytics] Unknown model pricing: ${model}`);
    return 0;
  }

  const {
    promptTokenCount = 0,
    candidatesTokenCount = 0,
    cachedContentTokenCount = 0,
  } = usageMetadata;

  // Calculate input cost (cached tokens at discount)
  const regularInputTokens = promptTokenCount - cachedContentTokenCount;
  const inputCost =
    (regularInputTokens * pricing.input) / 1_000_000 +
    (cachedContentTokenCount * pricing.cachedInput) / 1_000_000;

  // Calculate output cost (no caching for output)
  const outputCost = (candidatesTokenCount * pricing.output) / 1_000_000;

  return inputCost + outputCost;
}

/**
 * Capture $ai_generation event for PostHog LLM analytics
 *
 * @example
 * const startTime = performance.now();
 * const result = await model.generateContent(prompt);
 * const latencyMs = performance.now() - startTime;
 *
 * await captureLLMGeneration({
 *   distinctId: userId || 'anonymous',
 *   model: 'gemini-2.5-flash-lite',
 *   endpoint: 'generateItinerary',
 *   usageMetadata: result.response.usageMetadata,
 *   latencyMs,
 *   success: true,
 * });
 */
export async function captureLLMGeneration(
  params: LLMGenerationParams
): Promise<void> {
  const {
    distinctId,
    model,
    endpoint,
    usageMetadata,
    latencyMs,
    success,
    error,
    properties = {},
  } = params;

  const cost = calculateCost(model, usageMetadata);
  const cacheHitRate = usageMetadata?.promptTokenCount
    ? ((usageMetadata.cachedContentTokenCount || 0) / usageMetadata.promptTokenCount) * 100
    : 0;

  // PostHog $ai_generation event schema
  // See: https://posthog.com/docs/ai-engineering/observability
  const eventProperties = {
    // Standard PostHog AI properties
    $ai_provider: "google",
    $ai_model: model,
    $ai_input_tokens: usageMetadata?.promptTokenCount || 0,
    $ai_output_tokens: usageMetadata?.candidatesTokenCount || 0,
    $ai_latency: latencyMs / 1000, // PostHog expects seconds
    $ai_total_cost_usd: cost,
    $ai_trace_id: crypto.randomUUID(),

    // Custom properties for deeper analysis
    endpoint,
    success,
    error: error || null,
    cached_tokens: usageMetadata?.cachedContentTokenCount || 0,
    cache_hit_rate: Math.round(cacheHitRate * 10) / 10, // 1 decimal
    total_tokens: usageMetadata?.totalTokenCount || 0,

    // Merge additional properties
    ...properties,
  };

  // Capture the event
  await captureServerEvent(distinctId, "$ai_generation", eventProperties);

  // Log for monitoring (matches existing logCacheMetrics format)
  console.log(
    `[LLM Analytics] ${endpoint}: ` +
    `model=${model}, input=${usageMetadata?.promptTokenCount || 0}, ` +
    `output=${usageMetadata?.candidatesTokenCount || 0}, ` +
    `cached=${usageMetadata?.cachedContentTokenCount || 0} (${cacheHitRate.toFixed(1)}%), ` +
    `cost=$${cost.toFixed(6)}, latency=${latencyMs.toFixed(0)}ms, ` +
    `success=${success}`
  );
}

/**
 * Helper to wrap Gemini API calls with analytics
 *
 * @example
 * const result = await withLLMAnalytics(
 *   'anonymous',
 *   'gemini-2.5-flash-lite',
 *   'generateItinerary',
 *   async () => {
 *     const result = await chat.sendMessage(prompt);
 *     return {
 *       response: result.response.text(),
 *       usageMetadata: result.response.usageMetadata,
 *     };
 *   },
 *   { destination: 'Paris' }
 * );
 */
export async function withLLMAnalytics<T>(
  distinctId: string,
  model: string,
  endpoint: string,
  fn: () => Promise<{ response: T; usageMetadata?: GeminiUsageMetadata }>,
  properties?: Record<string, unknown>
): Promise<T> {
  const startTime = performance.now();
  let usageMetadata: GeminiUsageMetadata | undefined;
  let success = false;
  let error: string | undefined;

  try {
    const result = await fn();
    usageMetadata = result.usageMetadata;
    success = true;
    return result.response;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
    throw err;
  } finally {
    const latencyMs = performance.now() - startTime;

    // Fire and forget - don't block on analytics
    captureLLMGeneration({
      distinctId,
      model,
      endpoint,
      usageMetadata,
      latencyMs,
      success,
      error,
      properties,
    }).catch((e) => {
      console.error("[LLM Analytics] Failed to capture event:", e);
    });
  }
}

/**
 * Get cost estimate for a model and token count
 * Useful for pre-flight cost warnings
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0
): number {
  const pricing = MODEL_PRICING[model as GeminiModel];
  if (!pricing) return 0;

  return calculateCost(model, {
    promptTokenCount: inputTokens,
    candidatesTokenCount: outputTokens,
    cachedContentTokenCount: cachedInputTokens,
  });
}
