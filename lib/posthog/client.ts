"use client";

import posthog from "posthog-js";

/**
 * PostHog Client Module
 *
 * PostHog is initialized in instrumentation-client.ts (Next.js 15.3+ pattern).
 * This module provides the posthog instance and helper functions for components.
 *
 * @see /instrumentation-client.ts for initialization
 * @see https://posthog.com/docs/libraries/next-js
 */

/**
 * Initialize PostHog client (legacy function for backward compatibility)
 *
 * In Next.js 15.3+, PostHog is automatically initialized via instrumentation-client.ts.
 * This function is kept for backward compatibility with existing code.
 */
export function initPostHog() {
  // PostHog is now initialized in instrumentation-client.ts
  // This function is kept for backward compatibility
  if (typeof window === "undefined") return;

  // Check if already initialized (via instrumentation-client.ts)
  const isInitialized = posthog.__loaded;

  if (isInitialized) {
    if (process.env.NODE_ENV === "development") {
      console.log("[PostHog] Already initialized via instrumentation-client.ts");
    }
    return;
  }

  // Fallback initialization if instrumentation-client.ts didn't run
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

  if (!key) {
    console.warn("[PostHog] Missing NEXT_PUBLIC_POSTHOG_KEY environment variable");
    return;
  }

  posthog.init(key, {
    api_host: host,
    capture_pageview: "history_change",
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    autocapture: true,
    disable_session_recording: false,
    capture_heatmaps: true,
    debug: process.env.NODE_ENV === "development",
  });
}

/**
 * Check if PostHog is initialized
 */
export function isPostHogInitialized(): boolean {
  return typeof window !== "undefined" && posthog.__loaded === true;
}

export { posthog };
