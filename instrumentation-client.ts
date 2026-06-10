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
        // React + browser-translator (Google Translate, Safari Reader, etc.)
        // mutate the DOM out from under React's reconciler. We can't fix
        // this in source — translators run after React commits. These are
        // benign noise from real users browsing with translation enabled.
        // See: https://github.com/facebook/react/issues/11538
        "Failed to execute 'removeChild' on 'Node'",
        "Failed to execute 'insertBefore' on 'Node'",
        "The node to be removed is not a child of this node",
        // Same family on WebKit/Safari (NotFoundError DOM exception):
        // Safari throws this when the DOM tree it's traversing has been
        // mutated by an extension or by the back/forward cache.
        "The object can not be found here",
        "NotFoundError: The object can not be found here",
        // Vercel Speed Insights / Web Vitals beacon is blocked by privacy
        // browsers (DuckDuckGo, Brave) and raises an "invalid origin" from
        // its own internal beacon code. Not actionable — the beacon being
        // blocked is the correct behavior in those browsers.
        "invalid origin",
        // ResizeObserver loop warnings — benign browser quirk, not a real bug
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        // Third-party browser-extension WebSocket noise (2026-06-09). A
        // device-fingerprinting extension injects an `imtgo_device_info_WS`
        // function that opens an insecure ws:// socket from our https://
        // page; Safari rejects it with "SecurityError: The operation is
        // insecure" and the extension retries on a setInterval, spamming
        // ~85 events/user/session. It was our single highest-volume Sentry
        // issue (JS-NEXTJS-14/15) and is NOT our code — the frame is
        // `imtgo_device_info_WS` in an `app:///es`-attributed inline script,
        // not any of our hashed chunks. Match by message + the injected
        // function name so we drop it without suppressing real
        // SecurityErrors from our own code.
        "The operation is insecure",
        "imtgo_device_info_WS",
      ],

      // Drop events originating from third-party beacons we can't control.
      // The /_vercel/speed-insights/vitals endpoint is loaded by Vercel's
      // own script; when a privacy browser blocks it, the script itself
      // throws — there's nothing we can fix in our code.
      denyUrls: [
        /\/_vercel\/speed-insights\//,
        /\/_vercel\/insights\//,
        // Third-party tag managers / extensions
        /extensions\//i,
        /^chrome:\/\//i,
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-extension:\/\//i,
        /^webkit-masked-url:\/\//i,
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

      // Drop breadcrumbs from browser extensions. Per LIVE_AUDIT P5,
      // extensions (e.g. TensorFlow-based content classifiers) spam
      // hundreds of console messages and XHRs that show up in Sentry
      // breadcrumb history attached to OUR errors — noise that makes
      // real bugs harder to diagnose. Filter URL-bearing breadcrumbs
      // whose URL is an extension protocol.
      beforeBreadcrumb(breadcrumb) {
        const url = (breadcrumb.data as { url?: string } | undefined)?.url;
        if (url && /^(chrome|moz|safari|webkit-masked-url)-extension:\/\//.test(url)) {
          return null;
        }
        return breadcrumb;
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
      // ╔══════════════════════════════════════════════════════════════╗
      // ║ ATT-COMPLIANCE GUARDRAIL — DO NOT ADD IDFA / DEVICE-ID OPTS  ║
      // ║                                                              ║
      // ║ This config is intentionally minimal. The App Privacy        ║
      // ║ Nutrition Label we ship to Apple (see                        ║
      // ║ docs/legal/app-privacy-label.md §10) declares "Device ID:    ║
      // ║ NO". That answer is only true as long as PostHog stays in    ║
      // ║ anonymous-distinct-id mode. The moment any of these options  ║
      // ║ is added, the answer flips to YES and the app crosses the    ║
      // ║ App Tracking Transparency threshold — we'd then HAVE to ship ║
      // ║ the OS ATT prompt on iOS 14.5+, which has ~25% opt-in rates  ║
      // ║ and tanks measurement quality across the funnel.             ║
      // ║                                                              ║
      // ║ BANNED options (PostHog SDK):                                ║
      // ║   - `advertising_id_collection_enabled: true`                ║
      // ║   - `enable_collect_everything: true` with PII fields        ║
      // ║   - `cross_subdomain_cookie: true` AND a domain that spans   ║
      // ║     beyond first-party (would qualify as cross-app tracking) ║
      // ║   - Any session-recording option that bypasses               ║
      // ║     hasSessionRecordingConsent                               ║
      // ║                                                              ║
      // ║ Before adding ANY new option here, re-read                   ║
      // ║ docs/legal/app-privacy-label.md and confirm the change       ║
      // ║ doesn't flip a declared-NO field to a YES.                   ║
      // ╚══════════════════════════════════════════════════════════════╝
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
