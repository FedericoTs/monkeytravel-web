/**
 * Sentry Server-Side Configuration
 *
 * This file configures Sentry for the Node.js server runtime.
 * It captures server-side errors, API route errors, and server component errors.
 */

import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "@/lib/observability/sentry-data-collection";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // No environment: on Vercel the SDK uses the deployment's own name
  // (production, preview), where NODE_ENV says "production" on every one.

  // Only report from real deployments.
  //
  // Without this, a developer running `next dev` sends errors into the SAME
  // Sentry project as production, tagged environment=development, where they
  // read as live incidents and burn quota. Set SENTRY_ENABLE_DEV=1 to opt a local
  // session back in when you are deliberately testing instrumentation.
  enabled:
    process.env.NODE_ENV === "production" ||
    process.env.SENTRY_ENABLE_DEV === "1",


  // Performance Monitoring
  // Capture 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // One transaction per request rather than streamed spans (the SDK default
  // since v11): the tracing views and the sampling above are set up for it.
  traceLifecycle: "static",

  // A message reported by lib/observability/server-failure.ts is sent from
  // inside its helper, so a stack attached to it names that helper, and Sentry
  // would title every such issue "send" instead of by its message.
  attachStacktrace: false,

  // Enable debug mode in development
  debug: false,

  // Nothing about the person (lib/observability/sentry-data-collection.ts).
  dataCollection: SENTRY_DATA_COLLECTION,

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
