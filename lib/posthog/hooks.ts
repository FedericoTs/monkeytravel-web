"use client";

import { useEffect, useState } from "react";
import type { PostHog } from "posthog-js";
import { onPostHogReady } from "./client";

/** The SDK as React state: null until instrumentation-client.ts has initialised it. */
export function usePostHog(): PostHog | null {
  const [posthog, setPostHog] = useState<PostHog | null>(null);
  useEffect(() => onPostHogReady(setPostHog), []);
  return posthog;
}

/**
 * Hook for boolean feature flags with loading state
 *
 * @param flagKey - The feature flag key
 * @returns { enabled: boolean | undefined, isLoading: boolean }
 */
export function useFlag(flagKey: string): {
  enabled: boolean | undefined;
  isLoading: boolean;
} {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let stopFlags: (() => void) | undefined;
    const stopReady = onPostHogReady((posthog) => {
      const read = () => setEnabled(posthog.isFeatureEnabled(flagKey));
      read();
      stopFlags = posthog.onFeatureFlags(read);
    });
    return () => {
      stopReady();
      stopFlags?.();
    };
  }, [flagKey]);

  return { enabled, isLoading: enabled === undefined };
}
