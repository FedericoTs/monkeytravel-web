/**
 * Resilient Gemini call for the small structured endpoints (decide,
 * packing-list, …). UX10X Master Plan Phase 0.1.
 *
 * Why this exists: api_request_logs (2026-06-19 → 2026-07-03) showed
 * /api/ai/decide failing 25% and /api/tools/packing-list 58% — every
 * failure a GoogleGenerativeAI 500/503 on gemini-2.5-flash-lite, called
 * exactly ONCE with no timeout, no retry, no fallback. Meanwhile the main
 * trip-generation path (hardened wrapper in lib/gemini.ts) fails 0.46%.
 * The decision-first front door depends on /api/ai/decide, so its
 * reliability is the hard gate before the front-door flag flips.
 *
 * Strategy: attempt the purpose's primary model twice (500ms backoff
 * between attempts — rides out transient 500s), then once on the sibling
 * model (different serving pool — dodges model-specific outages). Each
 * attempt races a bounded timeout so worst-case route latency stays
 * predictable (these are 3-5s p50 calls; nothing should hang for 50s).
 *
 * Callers keep ownership of prompt building, JSON parsing/validation, and
 * logCacheMetrics — this wrapper is transport-resilience only.
 */
import {
  GoogleGenerativeAI,
  type Content,
  type GenerationConfig,
  type GenerateContentResult,
} from "@google/generative-ai";
import {
  getModelForPurpose,
  getSiblingModel,
  type GeminiPurpose,
  type GeminiModelId,
} from "./model-router";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/** Same Promise.race pattern as lib/gemini.ts withTimeout (house style). */
function withAttemptTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label}: attempt timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

export interface ResilientGenerateOptions {
  purpose: GeminiPurpose;
  generationConfig: GenerationConfig;
  contents: Content[];
  /** For log lines + timeout error messages, e.g. "ai.decide". */
  label: string;
  /** Per-attempt cap. Default 15s — generous for flash-lite p95 ~10s. */
  attemptTimeoutMs?: number;
}

export interface ResilientGenerateResult {
  result: GenerateContentResult;
  /** Which model actually answered (primary or sibling) — put in meta/logs. */
  modelUsed: GeminiModelId;
  attempts: number;
}

export async function generateContentResilient(
  opts: ResilientGenerateOptions
): Promise<ResilientGenerateResult> {
  const timeoutMs = opts.attemptTimeoutMs ?? 15_000;
  const primary = getModelForPurpose(opts.purpose);
  // [primary, primary, sibling]: two shots at the chosen model, one escape
  // hatch on the other pool.
  const plan: GeminiModelId[] = [primary, primary, getSiblingModel(primary)];

  let lastError: unknown;
  for (let i = 0; i < plan.length; i++) {
    const modelId = plan[i];
    try {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: opts.generationConfig,
      });
      const result = await withAttemptTimeout(
        model.generateContent({ contents: opts.contents }),
        timeoutMs,
        opts.label
      );
      if (i > 0) {
        // Recovered attempts are the whole point — make them visible in
        // Vercel logs so we can see how often the fallback is earning rent.
        console.warn(
          `[${opts.label}] recovered on attempt ${i + 1}/${plan.length} via ${modelId}`
        );
      }
      return { result, modelUsed: modelId, attempts: i + 1 };
    } catch (err) {
      lastError = err;
      console.warn(
        `[${opts.label}] attempt ${i + 1}/${plan.length} on ${modelId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${opts.label}: all model attempts failed`);
}
