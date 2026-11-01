/**
 * For a write the caller goes on without: a status note, a log row, a cache
 * entry. Supabase reports a refused write in `error` instead of throwing, so a
 * try/catch around it never sees one; this logs it instead of letting it
 * vanish.
 */
export function logWriteError(label: string, result: { error: { message: string } | null } | null | undefined): void {
  if (result?.error) console.error(`[${label}] write failed:`, result.error.message);
}
