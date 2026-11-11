/**
 * For a write the caller goes on without: a status note, a log row, a cache
 * entry. Supabase reports a refused write in `error` instead of throwing, so a
 * try/catch around it never sees one; this logs it instead of letting it
 * vanish, and on the server tells Sentry too.
 */
export function logWriteError(label: string, result: { error: { message: string } | null } | null | undefined): void {
  if (!result?.error) return;
  const reason = result.error.message;
  console.error(`[${label}] write failed:`, reason);
  // Browser pages use this too; the reporter is server code (next/server).
  if (typeof window === "undefined") {
    void import("@/lib/observability/server-failure")
      .then(({ reportServerFailure }) =>
        reportServerFailure(`[${label}] write failed: ${reason}`, "warning", [label, "write failed"]),
      )
      .catch(() => {});
  }
}
