import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What a Gemini response costs, and what one request's Gemini calls cost.
 *
 * WHY (2026-09-26)
 * A $100 Google Cloud budget alert arrived while api_request_logs said Gemini
 * had cost ~$3 that month. The log was wrong twice over: the trip-generation
 * routes booked a flat $0.003 per request (other AI routes flat guesses of
 * $0.0002-0.002), and [LLM Analytics] priced 2.5 Flash at preview-era rates,
 * $0.15 in / $0.60 out per 1M tokens. Google's paid-tier price is $0.30 in /
 * $2.50 out, and a trip is ~1.9k tokens in and 3-13k out (production logs,
 * 2026-09-26), so one generation costs ~$0.01-0.03. Priced properly, September
 * comes to roughly $20, not $3.
 *
 * Prices are LIST prices, USD per 1M tokens: paid tier, Standard, text input,
 * from https://ai.google.dev/gemini-api/docs/pricing (read 2026-09-26), prompts
 * under 200k tokens. A key on the free tier pays nothing, so the bill (Cloud
 * console → Billing → Reports) remains the source of truth.
 */
export const GEMINI_PRICE_PER_1M = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cachedInput: 0.01 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cachedInput: 0.125 },
} as const;

type PricedModel = keyof typeof GEMINI_PRICE_PER_1M;

/** The response's usageMetadata. `thoughtsTokenCount` is billed as output. */
export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

const warnedModels = new Set<string>();

/**
 * List price of one Gemini response, in USD.
 *
 * An unknown model is priced as the most expensive one (Pro) and warned about
 * once, so a new model can only make the figure too high, never too low.
 */
export function geminiCostUsd(model: string | undefined, usage: GeminiUsage | undefined): number {
  if (!usage) return 0;
  let price = GEMINI_PRICE_PER_1M[model as PricedModel];
  if (!price) {
    const name = model ?? "(none)";
    if (!warnedModels.has(name)) {
      warnedModels.add(name);
      console.warn(`[gemini-cost] no price for model ${name}; priced as gemini-2.5-pro`);
    }
    price = GEMINI_PRICE_PER_1M["gemini-2.5-pro"];
  }
  const prompt = usage.promptTokenCount ?? 0;
  const cached = Math.min(usage.cachedContentTokenCount ?? 0, prompt);
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return ((prompt - cached) * price.input + cached * price.cachedInput + output * price.output) / 1_000_000;
}

const meters = new AsyncLocalStorage<GeminiCostMeter>();

/**
 * One request's Gemini spend. Every Gemini response received inside `run()`
 * (logCacheMetrics records each one) is added, retries and parallel per-city
 * calls included, so a route can log what the request really cost:
 *
 *   const geminiCost = new GeminiCostMeter();
 *   const day = await geminiCost.run(() => regenerateSingleDay(...));
 *   await logApiCall({ ..., costUsd: geminiCost.usd, exactCost: true });
 *
 * A request that joins another's in-flight call (lib/gemini.ts dedup) adds
 * nothing: the request that made the call carries its cost.
 */
export class GeminiCostMeter {
  private total = 0;

  /** USD so far. */
  get usd(): number {
    return this.total;
  }

  add(usd: number): void {
    this.total += usd;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return meters.run(this, fn);
  }
}

/** Adds one Gemini response to the running request's meter; a no-op outside one. */
export function recordGeminiUsage(model: string | undefined, usage: GeminiUsage | undefined): void {
  meters.getStore()?.add(geminiCostUsd(model, usage));
}
