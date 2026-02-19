/**
 * Client-Side Instrumentation
 *
 * This file initializes client-side monitoring tools:
 * - Sentry: Error tracking (essential) - always on for error reporting
 * - PostHog: Analytics (optional) - only initialized with user consent
 *
 * PERFORMANCE: Both libraries are dynamically imported and deferred to after
 * initial paint via requestIdleCallback. This removes ~150-200 KB from the
 * initial JS bundle while still loading on every page visit.
 *
 * GDPR Compliance: Analytics tracking requires user consent.
 * Sentry error tracking is essential for site functionality.
 * Session replay requires explicit sessionRecording consent.
 *
 * Runs automatically in the browser context (Next.js 15.3+).
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * @see https://posthog.com/docs/libraries/next-js
 */

// Helper to check consent from localStorage (runs before React)
function getStoredConsent(): { analytics: boolean; sessionRecording: boolean } | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return null;
  }
  try {
    const stored = localStorage.getItem("mt_cookie_consent");
    if (!stored) return null;
    const record = JSON.parse(stored);
    return record?.consent || null;
  } catch {
    return null;
  }
}

// Sentry router transition tracking — populated after Sentry loads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _captureRouterTransitionStart: ((...args: any[]) => void) | undefined;

/**
 * Router transition handler for Sentry performance monitoring.
 * Delegates to Sentry.captureRouterTransitionStart once Sentry is loaded.
 * No-ops safely if Sentry hasn't loaded yet.
 */
export function onRouterTransitionStart(...args: unknown[]) {
  _captureRouterTransitionStart?.(...args);
}

/**
 * Deferred initialization of monitoring libraries.
 * Called via requestIdleCallback to avoid blocking initial paint.
 */
function initMonitoring() {
  // Get consent state (read once, shared by both init paths)
  const initialConsent = getStoredConsent();
  const hasAnalyticsConsent = initialConsent?.analytics ?? false;
  const hasSessionRecordingConsent = initialConsent?.sessionRecording ?? false;

  /**
   * Sentry Initialization
   *
   * Error tracking is considered essential functionality.
   * Session replay is ONLY enabled if user has given explicit consent.
   */
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

      // Environment identification
      environment: process.env.NODE_ENV,

      // Performance Monitoring - only with analytics consent
      tracesSampleRate: hasAnalyticsConsent
        ? process.env.NODE_ENV === "production"
          ? 0.1
          : 1.0
        : 0,

      // Session Replay - ONLY with explicit sessionRecording consent (GDPR)
      replaysSessionSampleRate: hasSessionRecordingConsent ? 0.1 : 0,
      replaysOnErrorSampleRate: hasSessionRecordingConsent ? 1.0 : 0,

      // Enable debug mode in development
      debug: process.env.NODE_ENV === "development",

      // Integrations - only add replay if consented
      integrations: hasSessionRecordingConsent
        ? [
            Sentry.replayIntegration({
              maskAllText: false,
              blockAllMedia: false,
            }),
          ]
        : [],

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

    // Wire up router transition tracking
    _captureRouterTransitionStart = Sentry.captureRouterTransitionStart;
  });

  /**
   * PostHog Initialization
   *
   * GDPR: Only initialize if user has given analytics consent.
   * PostHog will be initialized later via consent-aware-init.ts if consent is given.
   */
  if (
    process.env.NEXT_PUBLIC_POSTHOG_KEY &&
    process.env.NEXT_PUBLIC_POSTHOG_HOST &&
    hasAnalyticsConsent // Only init with consent
  ) {
    import("posthog-js").then(({ default: posthog }) => {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
        defaults: "2025-05-24",
        debug: process.env.NODE_ENV === "development",
        // Disable session recording unless explicitly consented
        disable_session_recording: !hasSessionRecordingConsent,
        loaded: (ph) => {
          if (typeof window !== "undefined") {
            (window as typeof window & { posthog: typeof posthog }).posthog = ph;
          }
          console.log("[PostHog] Initialized with consent, distinct_id:", ph.get_distinct_id());
        },
      });

      (window as typeof window & { posthog: typeof posthog }).posthog = posthog;
    });
  } else if (typeof window !== "undefined") {
    console.log("[PostHog] Skipped - waiting for analytics consent");
  }
}

// Schedule initialization after initial paint
if (typeof window !== "undefined") {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(initMonitoring, { timeout: 3000 });
  } else {
    // Fallback for Safari (no requestIdleCallback support)
    setTimeout(initMonitoring, 1500);
  }
}
