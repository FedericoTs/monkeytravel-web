/**
 * Consent-Aware Analytics Initialization
 *
 * Initializes analytics services only when user has given consent.
 * Listens for consent changes and starts/stops tracking accordingly.
 */

import { ConsentState, CONSENT_CHANGE_EVENT } from "@/lib/consent";
import { loadLocalConsent } from "@/lib/consent/storage";

// Track initialization state
let posthogInitialized = false;
let sentryInitialized = false;

/**
 * Initialize PostHog if consent is given
 */
export async function initPostHogWithConsent(): Promise<void> {
  if (typeof window === "undefined") return;
  if (posthogInitialized) return;

  const consent = loadLocalConsent()?.consent;
  if (!consent?.analytics) {
    console.log("[PostHog] Skipping init - no analytics consent");
    return;
  }

  try {
    const posthog = (await import("posthog-js")).default;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    if (!key || !host) {
      console.warn("[PostHog] Missing environment variables");
      return;
    }

    posthog.init(key, {
      api_host: host,
      defaults: "2025-05-24",
      debug: process.env.NODE_ENV === "development",
      // Disable session recording unless explicitly consented
      disable_session_recording: !consent.sessionRecording,
      loaded: (ph) => {
        if (typeof window !== "undefined") {
          (window as typeof window & { posthog: typeof posthog }).posthog = ph;
        }
        console.log("[PostHog] Initialized with consent");
      },
    });

    posthogInitialized = true;

    // Also expose on window for debugging
    (window as typeof window & { posthog: typeof posthog }).posthog = posthog;
  } catch (error) {
    console.error("[PostHog] Failed to initialize:", error);
  }
}

/**
 * Initialize Sentry if consent is given
 */
export async function initSentryWithConsent(): Promise<void> {
  if (typeof window === "undefined") return;
  if (sentryInitialized) return;

  const consent = loadLocalConsent()?.consent;
  if (!consent?.analytics) {
    console.log("[Sentry] Skipping init - no analytics consent");
    return;
  }

  try {
    const Sentry = await import("@sentry/nextjs");
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

    if (!dsn) {
      console.warn("[Sentry] Missing SENTRY_DSN");
      return;
    }

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      // Disable session replay unless explicitly consented
      replaysSessionSampleRate: consent.sessionRecording ? 0.1 : 0,
      replaysOnErrorSampleRate: consent.sessionRecording ? 1.0 : 0,
      debug: process.env.NODE_ENV === "development",
      integrations: consent.sessionRecording
        ? [
            Sentry.replayIntegration({
              maskAllText: false,
              blockAllMedia: false,
            }),
          ]
        : [],
      ignoreErrors: [
        "top.GLOBALS",
        "canvas.contentDocument",
        "MyApp_RemoveAllHighlights",
        "atomicFindClose",
        "fb_xd_fragment",
        "Network Error",
        "NetworkError",
        "Failed to fetch",
        "Load failed",
        "chrome-extension://",
        "safari-extension://",
        "moz-extension://",
        "webkit-masked-url://",
        "The operation couldn't be completed",
        "AbortError",
        "The user aborted a request",
      ],
      sendDefaultPii: false,
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
      beforeSend(event) {
        if (
          process.env.NODE_ENV === "development" &&
          !process.env.SENTRY_DEBUG
        ) {
          console.log("[Sentry] Event captured (dev mode - not sent):", event);
          return null;
        }
        return event;
      },
    });

    sentryInitialized = true;
    console.log("[Sentry] Initialized with consent");
  } catch (error) {
    console.error("[Sentry] Failed to initialize:", error);
  }
}

/**
 * Handle consent changes
 */
async function handleConsentChange(consent: ConsentState): Promise<void> {
  if (consent.analytics) {
    // Initialize analytics if not already done
    await initPostHogWithConsent();
    await initSentryWithConsent();

    // Update PostHog session recording setting
    if (typeof window !== "undefined") {
      const posthog = (window as typeof window & { posthog?: { set_config?: (opts: Record<string, unknown>) => void } }).posthog;
      if (posthog?.set_config) {
        posthog.set_config({
          disable_session_recording: !consent.sessionRecording,
        });
      }
    }
  } else {
    // User revoked consent - stop tracking
    if (typeof window !== "undefined") {
      const posthog = (window as typeof window & { posthog?: { opt_out_capturing?: () => void } }).posthog;
      if (posthog?.opt_out_capturing) {
        posthog.opt_out_capturing();
        console.log("[PostHog] Opted out due to consent revocation");
      }
    }
  }
}

/**
 * Set up consent listener for runtime consent changes
 */
export function setupConsentListener(): void {
  if (typeof window === "undefined") return;

  // Check initial consent and initialize if allowed
  const initialConsent = loadLocalConsent()?.consent;
  if (initialConsent?.analytics) {
    initPostHogWithConsent();
    initSentryWithConsent();
  }

  // Listen for consent changes
  window.addEventListener(CONSENT_CHANGE_EVENT, ((
    event: CustomEvent<ConsentState>
  ) => {
    handleConsentChange(event.detail);
  }) as EventListener);

  console.log("[Analytics] Consent listener set up");
}

/**
 * Check if PostHog is initialized
 */
export function isPostHogReady(): boolean {
  return posthogInitialized;
}

/**
 * Check if Sentry is initialized
 */
export function isSentryReady(): boolean {
  return sentryInitialized;
}
