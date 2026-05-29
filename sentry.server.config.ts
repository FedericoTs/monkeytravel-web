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
