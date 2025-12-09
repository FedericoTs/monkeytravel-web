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
  beforeSend(event) {
    // Remove sensitive headers
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }
    return event;
  },

  // Ignore certain server-side errors
  ignoreErrors: [
    // Expected errors
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT",
    // Database connection issues (temporary)
    "ECONNREFUSED",
    "ETIMEDOUT",
  ],
});
