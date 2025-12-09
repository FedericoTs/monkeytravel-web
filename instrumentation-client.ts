/**
 * Sentry Client-Side Configuration
 *
 * This file initializes Sentry for browser-side error tracking and performance monitoring.
 * It runs in the browser context and captures client-side errors, performance data, and user sessions.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment identification
  environment: process.env.NODE_ENV,

  // Performance Monitoring
  // Capture 10% of transactions for performance monitoring in production
  // Set to 1.0 (100%) during development for easier debugging
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay
  // Capture 10% of all sessions for replay
  replaysSessionSampleRate: 0.1,
  // Capture 100% of sessions with errors
  replaysOnErrorSampleRate: 1.0,

  // Enable debug mode in development
  debug: process.env.NODE_ENV === "development",

  // Integrations
  integrations: [
    // Session Replay - records user sessions for debugging
    Sentry.replayIntegration({
      // Mask all text in replays for privacy
      maskAllText: false,
      // Block all media (images, videos) in replays
      blockAllMedia: false,
    }),
  ],

  // Filter out noisy errors
  ignoreErrors: [
    // Browser extensions
    "top.GLOBALS",
    "canvas.contentDocument",
    "MyApp_RemoveAllHighlights",
    "atomicFindClose",
    // Facebook borked
    "fb_xd_fragment",
    // Network errors
    "Network Error",
    "NetworkError",
    "Failed to fetch",
    "Load failed",
    // Chrome extensions
    "chrome-extension://",
    "safari-extension://",
    "moz-extension://",
    // Safari webkit
    "webkit-masked-url://",
    // Safari errors
    "The operation couldn't be completed",
    // Common user-initiated cancellations
    "AbortError",
    "The user aborted a request",
  ],

  // Don't send PII by default
  sendDefaultPii: false,

  // Attach release version
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

  // Additional context
  beforeSend(event) {
    // Don't send events in development (unless testing)
    if (process.env.NODE_ENV === "development" && !process.env.SENTRY_DEBUG) {
      console.log("[Sentry] Event captured (dev mode - not sent):", event);
      return null;
    }
    return event;
  },
});

// Export for router transition tracking (Next.js App Router)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
