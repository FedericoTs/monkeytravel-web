/**
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded by Next.js to initialize monitoring
 * and instrumentation before the application starts.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Before Sentry loads: Sentry pulls in @opentelemetry/instrumentation-http,
    // which still calls the deprecated url.parse(). That single warning was the
    // loudest line in production (201/24h across nearly every route) and buried
    // real errors. Filtered narrowly — only when raised from inside
    // @opentelemetry — so our own code would still surface it.
    const { silenceOtelUrlParseDeprecation } = await import(
      "./lib/observability/silence-otel-url-parse-deprecation"
    );
    silenceOtelUrlParseDeprecation();

    // Server-side Sentry initialization
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime Sentry initialization
    await import("./sentry.edge.config");
  }
}

/**
 * Capture errors from Server Components (Next.js 15+)
 * This hook catches errors that occur during server-side rendering.
 */
export const onRequestError = Sentry.captureRequestError;
