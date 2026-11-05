/**
 * What the Gemini calls of itinerary generation and regeneration share: the
 * client, the time limit on a call, and the retries around an attempt.
 */

import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";

export const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Per-attempt timeout for AI requests. 50s covers the P99 latency of an
// 8K-token response (~45s); itineraryTimeoutMs raises it for trips over 7 days.
// At most two attempts (MAX_RETRIES = 1, 1s pause after an API error), so at
// 50s the worst case, 50 + 1 + 50 = 101s, fits the generate route's 120s
// maxDuration (vercel.json). One retry only: a timed-out attempt usually means
// Gemini is stuck on that prompt and re-sending it rarely recovers; the
// lower-temperature retry still catches transient blips.
export const AI_REQUEST_TIMEOUT_MS = 50_000;

/**
 * Race a promise against a timeout. Throws if the timeout expires first.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

export const MAX_RETRIES = 1;

/**
 * How one attempt at a model call ended: with its answer, with an answer it
 * could not use (it did not parse, or lacked what was asked for), or with the
 * call failing (a timeout, quota, an outage).
 */
export type Attempt<T> = { value: T } | { unusable: true } | { failed: unknown };

/**
 * Runs a model call's attempts. An unusable answer is asked for again at once,
 * a failed call after a pause (a second longer for each retry); at most
 * MAX_RETRIES retries. Each attempt logs and reports itself; this logs the
 * retries and, when none is left, throws `gaveUp` (an unusable answer) or
 * `unavailable(error)` (a failed call).
 */
export async function withRetries<T>(
  attempt: (retryCount: number) => Promise<Attempt<T>>,
  call: { retrying: string; gaveUp: string; unavailable: (error: unknown) => Error }
): Promise<T> {
  for (let retryCount = 0; ; retryCount++) {
    const outcome = await attempt(retryCount);
    if ("value" in outcome) return outcome.value;
    const last = retryCount >= MAX_RETRIES;
    if ("failed" in outcome) {
      if (last) throw call.unavailable(outcome.failed);
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
    } else {
      if (last) throw new Error(call.gaveUp);
      console.log(`Retrying ${call.retrying} (attempt ${retryCount + 2})...`);
    }
  }
}
