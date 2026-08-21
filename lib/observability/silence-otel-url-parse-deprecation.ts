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
 * WHY IT IS NOT SCOPED BY STACK
 *
 * The first attempt only swallowed the warning when the emitting stack matched
 * /node_modules/@opentelemetry/. It shipped and did nothing: verified against
 * production with forced cold starts, DEP0169 kept firing. The reason is that
 * Next bundles server code, so the caller frame is a .next/server/chunks/* path
 * rather than the original node_modules path — the regex could never match.
 *
 * Rather than chase bundler-dependent paths at runtime, the safety property is
 * enforced STATICALLY instead: silence-otel-url-parse-deprecation.vitest.ts
 * scans our own source and fails if anything under app/, lib/ or components/
 * ever calls url.parse(). That check is reliable, runs in CI, and fails loudly
 * at the moment the assumption breaks — which fragile stack matching did not.
 *
 * So the runtime filter is deliberately simple: drop DEP0169, full stop. It is
 * safe precisely because the test guarantees the only possible source is a
 * dependency.
 */

const SUPPRESSED_CODE = "DEP0169";

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

    if (code === SUPPRESSED_CODE) {
      return; // known, harmless, upstream — already fixed in otel 0.221.0
    }

    return (original as (...args: unknown[]) => void)(warning, ...rest);
  } as typeof process.emitWarning;
}
