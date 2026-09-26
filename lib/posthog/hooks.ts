"use client";

import { useFeatureFlagEnabled } from "posthog-js/react";

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
  const enabled = useFeatureFlagEnabled(flagKey);
  const isLoading = enabled === undefined;

  return { enabled, isLoading };
}
