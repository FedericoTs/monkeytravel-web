import { PostHog } from "posthog-node";

let serverPostHog: PostHog | null = null;

/**
 * Get server-side PostHog client
 *
 * Uses posthog-node for:
 * - Server Components
 * - API Routes
 * - Middleware
 */
export function getServerPostHog(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

  if (!key) {
    console.warn("[PostHog Server] Missing API key");
    return null;
  }

  if (!serverPostHog) {
    serverPostHog = new PostHog(key, {
      host,
      // Flush events immediately in serverless
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return serverPostHog;
}

/**
 * Capture event server-side.
 *
 * IMPORTANT: this routes the flush through Vercel's `waitUntil()` so the
 * serverless function stays alive long enough for the network round-trip
 * to PostHog. Without this, callers that fire-and-forget the capture (the
 * common case — `captureLLMGeneration({...}).catch(() => {})` in
 * `lib/gemini.ts`) would see the function terminate as soon as the API
 * route returns its Response, killing the in-flight flush and dropping
 * the event silently. We confirmed this was happening: zero
 * `$ai_generation` events made it to PostHog in the last 30 days despite
 * 9 call sites in `lib/gemini.ts`.
 *
 * Outside Vercel (local dev, tests, non-Vercel hosts), `process.env.VERCEL`
 * is unset and we simply `await ph.flush()` as before.
 */
export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
) {
  const ph = getServerPostHog();
  if (!ph) return;

  ph.capture({
    distinctId,
    event,
    properties,
  });

  const flushPromise = ph.flush().catch((err) => {
    console.error("[PostHog Server] Failed to flush:", err);
  });

  if (process.env.VERCEL) {
    try {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(flushPromise);
      return;
    } catch {
      // @vercel/functions unavailable for some reason — fall through to
      // the local-dev path (await directly, slows the response slightly
      // but never drops the event).
    }
  }

  await flushPromise;
}

/**
 * Get feature flags server-side
 */
export async function getServerFeatureFlags(
  distinctId: string
): Promise<Record<string, boolean | string> | null> {
  const ph = getServerPostHog();
  if (!ph) return null;

  try {
    const flags = await ph.getAllFlags(distinctId);
    return flags;
  } catch (error) {
    console.error("[PostHog Server] Error fetching flags:", error);
    return null;
  }
}

/**
 * Get single feature flag server-side
 */
export async function getServerFeatureFlag(
  distinctId: string,
  flagKey: string
): Promise<boolean | string | undefined> {
  const ph = getServerPostHog();
  if (!ph) return undefined;

  try {
    const value = await ph.getFeatureFlag(flagKey, distinctId);
    return value;
  } catch (error) {
    console.error("[PostHog Server] Error fetching flag:", error);
    return undefined;
  }
}

/**
 * Shutdown server client (call in API route cleanup)
 */
export async function shutdownServerPostHog() {
  if (serverPostHog) {
    await serverPostHog.shutdown();
    serverPostHog = null;
  }
}
