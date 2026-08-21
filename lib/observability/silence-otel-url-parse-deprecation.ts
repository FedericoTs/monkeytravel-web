/**
 * Silence Node's DEP0169 (`url.parse()`) warning — but ONLY when it comes from
 * OpenTelemetry, never from our own code.
 *
 * WHY THIS EXISTS
 *
 * DEP0169 was the single loudest line in production: 201 occurrences in 24h,
 * spread across nearly every route. It is not a bug and nothing is broken — but
 * it drowned the real errors in the runtime logs, which is its own hazard.
 *
 * The source is not ours. Traced to:
 *
 *   @sentry/nextjs@10.29.0
 *     └─ @sentry/node@10.29.0
 *          └─ @opentelemetry/instrumentation-http@0.208.0
 *               build/src/utils.js:24  const url = require("url");
 *               build/src/utils.js:49  const parsedUrl = url.parse(path);
 *
 * It fires while redacting sensitive query parameters, so any request path
 * containing "?" triggers it. Node emits a deprecation once per process, which
 * is why the count tracks lambda cold starts rather than traffic.
 *
 * WHY NOT JUST UPGRADE
 *
 * Upstream already fixed it — @opentelemetry/instrumentation-http@0.221.0 has
 * no live `url.parse()` call. But we cannot reach it cheaply:
 *
 *   - @sentry/node@10.29.0 pins instrumentation-http to EXACTLY 0.208.0.
 *   - Forcing 0.221.0 via npm `overrides` drags in its own exact pins
 *     (@opentelemetry/core 2.10.0, @opentelemetry/instrumentation 0.221.0)
 *     alongside Sentry's (core 2.2.0, instrumentation 0.208.0). OpenTelemetry
 *     registers globals as singletons, so two copies of core in one tree can
 *     silently break tracing. That is a bad trade for a log line.
 *   - The clean fix is a Sentry upgrade (10.29 -> 10.70+, where the dependency
 *     was restructured away). That is a 40+ minor-version jump and deserves its
 *     own change with its own testing, not a drive-by.
 *
 * So: filter the warning, keep the dependency tree intact, and revisit when
 * Sentry is upgraded on purpose.
 *
 * WHY IT IS SCOPED TO THE OTEL FRAME
 *
 * Blanket-suppressing DEP0169 would also hide the warning if OUR code ever
 * started calling url.parse() — exactly the signal worth keeping. So the filter
 * checks the emitting stack and only swallows warnings raised from inside
 * @opentelemetry. Anything else is passed straight through untouched, and the
 * suppression stops working by itself the moment the source changes.
 */

const OTEL_FRAME = /[\\/]node_modules[\\/]@opentelemetry[\\/]/;

let installed = false;

export function silenceOtelUrlParseDeprecation(): void {
  // Node-only: process.emitWarning does not exist on the edge runtime.
  if (installed || typeof process === "undefined" || typeof process.emitWarning !== "function") {
    return;
  }
  installed = true;

  const original = process.emitWarning.bind(process);

  // Mirrors both documented overloads:
  //   emitWarning(warning[, options])
  //   emitWarning(warning[, type[, code[, ctor]]])
  process.emitWarning = function patched(
    warning: string | Error,
    ...rest: unknown[]
  ): void {
    const code =
      typeof rest[0] === "object" && rest[0] !== null
        ? (rest[0] as { code?: string }).code
        : (rest[1] as string | undefined);

    if (code === "DEP0169") {
      // Where is it actually being raised from? Capture the live stack rather
      // than trusting the warning object, which Node builds internally.
      const emittedFrom = new Error().stack ?? "";
      if (OTEL_FRAME.test(emittedFrom)) {
        return; // known, harmless, upstream — and already fixed in 0.221.0
      }
    }

    return (original as (...args: unknown[]) => void)(warning, ...rest);
  } as typeof process.emitWarning;
}
