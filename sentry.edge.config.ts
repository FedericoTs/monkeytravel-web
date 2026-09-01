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
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Enable debug mode in development
  debug: false,

  // Attach release version
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
});
