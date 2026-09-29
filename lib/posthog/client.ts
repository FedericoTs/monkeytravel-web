import type { PostHog } from "posthog-js";

/** Fired on `window` by instrumentation-client.ts once the SDK is initialised. */
export const POSTHOG_READY_EVENT = "mt_posthog_ready";

type PostHogWindow = Window & { posthog?: PostHog };

/**
 * The SDK instance that instrumentation-client.ts installs on `window` after
 * its idle-time init, or null before that and on the server. Nothing else
 * imports posthog-js: a static import anywhere would put the SDK into that
 * route's initial bundle.
 */
export function getPostHog(): PostHog | null {
  if (typeof window === "undefined") return null;
  return (window as PostHogWindow).posthog ?? null;
}

/** Calls `fn` with the SDK as soon as it is available. Returns an unsubscribe. */
export function onPostHogReady(fn: (posthog: PostHog) => void): () => void {
  const ready = getPostHog();
  if (ready) {
    fn(ready);
    return () => {};
  }
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    const posthog = getPostHog();
    if (posthog) fn(posthog);
  };
  window.addEventListener(POSTHOG_READY_EVENT, handler, { once: true });
  return () => window.removeEventListener(POSTHOG_READY_EVENT, handler);
}
