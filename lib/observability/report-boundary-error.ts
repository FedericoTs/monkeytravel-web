import * as Sentry from "@sentry/nextjs";

/**
 * Report an error caught by a React error boundary, with enough context that
 * the event is still diagnosable when Sentry cannot build a stack trace.
 *
 * WHY THIS EXISTS
 *
 * Sentry JAVASCRIPT-NEXTJS-23 ("Cannot access 'q' before initialization",
 * /trips/new) arrived with:
 *
 *     Stacktrace: No stacktrace available
 *
 * Its siblings (-1W, 6 users; -20) had a stack, but a minified one. So the
 * whole TDZ family — the largest user-facing error group in the project — has
 * been undebuggable: sometimes minified, sometimes nothing at all.
 *
 * The boundaries were calling captureException(error) with only a tag. That is
 * correct as far as it goes, but it throws away three things that survive even
 * when frame parsing fails:
 *
 *   - error.stack as a RAW STRING. Sentry builds its stacktrace by parsing
 *     frames; when that parse yields nothing the original string is still on
 *     the Error object. Keeping it means "no stacktrace available" no longer
 *     means "no information".
 *   - error.digest. Next.js strips server-side error messages in production
 *     and leaves only this id, which is the sole way to correlate the client
 *     event with the server log.
 *   - which route the boundary fired on, without relying on the URL tag alone.
 *
 * Deliberately no query strings or hrefs: Sentry already records the URL, and
 * repeating it here risks copying tokens (e.g. /shared/<token>) into a second
 * field. Pathname only.
 */
/**
 * Resolve `error.stack` to a STRING, or explain why it could not be.
 *
 * The first version of this helper assumed `error.stack` was a string and
 * handed it straight to Sentry. JAVASCRIPT-NEXTJS-23 then recorded:
 *
 *     rawStack: "[Function: <anonymous>]"
 *
 * — Sentry's normalizer stringifying a FUNCTION. So on the very event this
 * helper was written for, `stack` was not a string, the raw-stack escape
 * hatch produced nothing, and the event stayed undebuggable.
 *
 * `stack` is not specified as a data property. It is an accessor on V8 and
 * can be replaced outright by instrumentation, polyfills, or a wrapper that
 * re-exposes it lazily. Read it defensively: invoke a thunk if that is what
 * we were handed, and otherwise say what the value actually was, so the next
 * occurrence names the problem instead of hiding it behind a placeholder.
 */
function resolveRawStack(error: Error & { digest?: string }): string {
  const raw: unknown = error.stack;

  if (typeof raw === "string") return raw;
  if (raw == null) return "(no stack present on the Error object)";

  // A lazily-materialised stack: call it, but never let instrumentation throw
  // out of the error path — a crash here would replace the real error.
  if (typeof raw === "function") {
    try {
      const called: unknown = (raw as () => unknown).call(error);
      if (typeof called === "string") return called;
      return `(error.stack was a function returning ${typeof called})`;
    } catch {
      return "(error.stack was a function that threw when called)";
    }
  }

  try {
    return `(error.stack was ${typeof raw}: ${String(raw)})`;
  } catch {
    return `(error.stack was ${typeof raw}, not stringifiable)`;
  }
}

export function reportBoundaryError(
  error: Error & { digest?: string },
  errorType: string
): void {
  Sentry.withScope((scope) => {
    scope.setTag("errorType", errorType);
    if (error.digest) scope.setTag("digest", error.digest);

    scope.setContext("boundary", {
      name: error.name,
      message: error.message,
      digest: error.digest ?? null,
      // The whole point: keep the raw stack even if Sentry parses no frames.
      rawStack: resolveRawStack(error),
      pathname:
        typeof window !== "undefined" ? window.location.pathname : null,
    });

    Sentry.captureException(error);
  });
}
