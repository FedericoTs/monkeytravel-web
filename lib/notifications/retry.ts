/**
 * Retry a Supabase read that failed for a transient reason.
 *
 * WHY THIS EXISTS (2026-09-14, 07:00:29 UTC)
 * The reminder cron runs once a day and starts with one SELECT of the due
 * rows. That morning the database answered "Gateway Timeout" (the instance was
 * swapping; see the 2026-09-12 diagnostic), the route returned 500 and nothing
 * was sent. Because every pre-trip subject line makes a claim about WHEN, the
 * next run could only suppress most of those rows as stale: 39 emails lost to
 * one eight-second timeout at the wrong moment.
 *
 * A single bounded retry turns that into a ten-second delay. Only messages
 * that look like a timeout or a dropped connection are retried; any other
 * error is returned as-is so the caller keeps its fail-closed behaviour.
 */

export const TRANSIENT_ERROR_RE =
  /gateway timeout|statement timeout|canceling statement|timed out|timeout|fetch failed|econnreset|socket hang up/i;

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Delay before attempt 2, 3, ... The last value repeats. Default [1500, 4000] ms. */
  delaysMs?: number[];
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry with the attempt number just failed. */
  onRetry?: (failedAttempt: number, message: string) => void;
}

/** The shape every supabase-js query resolves to. */
export interface ErrorCarrier {
  error: { message: string } | null;
}

export function isTransientMessage(message: string | null | undefined): boolean {
  return !!message && TRANSIENT_ERROR_RE.test(message);
}

/**
 * Run `query` and, while it resolves with a transient error, run it again
 * after a short delay. Returns the last result either way; never throws for a
 * query error (a thrown exception from `query` itself propagates as usual).
 */
export async function retryTransient<T extends ErrorCarrier>(
  query: () => PromiseLike<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delays = opts.delaysMs && opts.delaysMs.length > 0 ? opts.delaysMs : [1500, 4000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let result = await query();
  for (let failed = 1; failed < attempts; failed++) {
    if (!result.error || !isTransientMessage(result.error.message)) break;
    opts.onRetry?.(failed, result.error.message);
    await sleep(delays[Math.min(failed - 1, delays.length - 1)]);
    result = await query();
  }
  return result;
}
