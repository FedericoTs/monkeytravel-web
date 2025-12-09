/**
 * Sentry Edge Runtime Configuration
 *
 * This file configures Sentry for Vercel Edge Runtime (middleware, edge API routes).
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment identification
  environment: process.env.NODE_ENV,

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Enable debug mode in development
  debug: false,

  // Attach release version
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
});
