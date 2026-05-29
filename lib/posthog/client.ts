"use client";

/**
 * PostHog Client Module
 *
 * PostHog is initialized in instrumentation-client.ts (Next.js 15.3+ pattern).
 * This module exposes a couple of legacy helpers kept for backward compat.
 *
 * BUNDLE NOTE (perf task #179, 2026-05-29): we previously did
 * `import posthog from "posthog-js"` at the top of this file, which
 * dragged the ~120 KB SDK into the shared chunk via the
 * `lib/posthog/index.ts` barrel re-export. We removed that. The only
 * runtime users of posthog-js now lazy-load it themselves
 * (events.ts, identify.ts) or read off `window.posthog`, which
 * `instrumentation-client.ts` populates after the idle-callback init.
 *
 * @see /instrumentation-client.ts for initialization
 * @see https://posthog.com/docs/libraries/next-js
 */

// Minimal shape of the global posthog handle set by instrumentation-client.ts
type WindowPosthog = {
  __loaded?: boolean;
};

function getWindowPosthog(): WindowPosthog | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { posthog?: WindowPosthog }).posthog;
}

/**
 * Initialize PostHog client (legacy no-op kept for backward compatibility)
 *
 * In Next.js 15.3+, PostHog is automatically initialized via
 * instrumentation-client.ts behind the user-consent gate. Calling this
 * function does nothing — it exists so older imports don't break.
 */
export function initPostHog() {
  // No-op: init happens in instrumentation-client.ts behind consent.
}

/**
 * Check if PostHog is initialized
 */
export function isPostHogInitialized(): boolean {
  return getWindowPosthog()?.__loaded === true;
}
