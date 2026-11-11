/**
 * Sentry Edge Runtime Configuration
 *
 * This file configures Sentry for Vercel Edge Runtime (middleware, edge API routes).
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
});
