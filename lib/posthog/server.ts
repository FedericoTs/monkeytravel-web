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
 * Capture event server-side
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

  // Flush immediately for serverless
  await ph.flush();
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
