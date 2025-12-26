/**
 * Client-Side Instrumentation
 *
 * This file initializes client-side monitoring tools:
 * - Sentry: Error tracking and performance monitoring
 * - PostHog: Analytics, feature flags, and A/B testing
 *
 * Runs automatically in the browser context (Next.js 15.3+).
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * @see https://posthog.com/docs/libraries/next-js
 */

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

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

/**
 * PostHog Initialization
 *
 * Initialize PostHog for analytics, feature flags, and A/B testing.
 * Uses the recommended defaults for 2025.
 */
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  process.env.NEXT_PUBLIC_POSTHOG_HOST
) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    // Use recommended defaults for 2025 (includes pageview, autocapture, session recording)
    defaults: "2025-05-24",
    // Enable debug mode to see what's happening
    debug: true,
    // Callback when loaded
    loaded: (ph) => {
      // Expose on window for debugging and React hooks
      if (typeof window !== "undefined") {
        (window as typeof window & { posthog: typeof posthog }).posthog = ph;
      }
      console.log("[PostHog] Initialized with distinct_id:", ph.get_distinct_id());
    },
  });

  // Also set immediately for synchronous access
  (window as typeof window & { posthog: typeof posthog }).posthog = posthog;
}

// Export PostHog instance for use in other files
export { posthog };
