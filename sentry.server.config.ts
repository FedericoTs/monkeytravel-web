/**
 * Sentry Server-Side Configuration
 *
 * This file configures Sentry for the Node.js server runtime.
 * It captures server-side errors, API route errors, and server component errors.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment identification
  environment: process.env.NODE_ENV,

  // Only report from real deployments.
  //
  // Without this, a developer running `next dev` sends errors into the SAME
  // Sentry project as production, tagged environment=development. On
  // 2026-09-01 that produced JAVASCRIPT-NEXTJS-2B -- "AI service unavailable
  // (root: Itinerary generation timed out after 50s)", culprit
  // POST /api/ai/generate -- which read as a live incident on the money path
  // and was investigated as one. It was a laptop: url http://localhost:3001,
  // server_name LAPTOP-8T935OI7, HeadlessChrome, users impacted 0, and zero
  // matching production events in the preceding 7 days.
  //
  // Local noise competes with real signal in a project that saw only 29 events
  // in 30 days, and it burns quota. Set SENTRY_ENABLE_DEV=1 to opt a local
  // session back in when you are deliberately testing instrumentation.
  enabled:
    process.env.NODE_ENV === "production" ||
    process.env.SENTRY_ENABLE_DEV === "1",


  // Performance Monitoring
  // Capture 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Enable debug mode in development
  debug: false,

  // Don't send PII by default
  sendDefaultPii: false,

  // Attach release version
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

  // Filter sensitive data from being sent to Sentry
  beforeSend(event, hint) {
    // Remove sensitive headers
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }

    // Scope ECONNREFUSED / ETIMEDOUT suppression to the /api/health probe only.
    // Anywhere else (Supabase, Resend, Amadeus, Google Places, Gemini, etc.)
    // these errors represent real outages and MUST be surfaced.
    const url = event.request?.url ?? "";
    const routeTag =
      typeof event.tags?.route === "string" ? event.tags.route : "";
    const isHealthRoute =
      url.includes("/api/health") || routeTag.includes("/api/health");

    if (isHealthRoute) {
      const errorValue = event.exception?.values?.[0]?.value ?? "";
      const hintMessage =
        hint?.originalException instanceof Error
          ? hint.originalException.message
          : typeof hint?.originalException === "string"
            ? hint.originalException
            : "";
      const combined = `${errorValue}\n${hintMessage}\n${event.message ?? ""}`;
      if (/ECONNREFUSED|ETIMEDOUT/.test(combined)) {
        return null;
      }
    }

    return event;
  },

  // Ignore certain server-side errors
  ignoreErrors: [
    // Expected Next.js control-flow signals (not real errors)
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT",
  ],
});
