import { isNoRow } from "./no-row";

/**
 * For a read the caller goes on without: a display name, a count for a badge,
 * an optional enrichment. Supabase reports a refused read in `error` instead
 * of throwing, so the caller would take it for "nothing found"; this logs it
 * and hands the result back unchanged. A `.single()` that found no row is not
 * a failure.
 */
export function logReadError<R extends { error: { message: string; code?: string } | null }>(label: string, result: R): R {
  if (result.error && !isNoRow(result.error)) console.error(`[${label}] read failed:`, result.error.message);
  return result;
}
