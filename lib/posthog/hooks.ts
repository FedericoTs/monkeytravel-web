"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useFeatureFlagEnabled,
  useFeatureFlagVariantKey,
  usePostHog,
} from "posthog-js/react";
import { getDefaultFlagValue } from "./flags";

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

/**
 * Hook for multivariate feature flags (A/B tests)
 *
 * Automatically tracks exposure when variant is loaded.
 *
 * @param flagKey - The experiment flag key
 * @returns { variant: string | undefined, isLoading: boolean }
 */
export function useExperiment(flagKey: string): {
  variant: string | undefined;
  isLoading: boolean;
} {
  const variant = useFeatureFlagVariantKey(flagKey);
  const isLoading = variant === undefined;

  return { variant: variant as string | undefined, isLoading };
}

/**
 * Hook for feature flags with fallback value
 *
 * Returns the fallback immediately while loading, then updates.
 *
 * @param flagKey - The feature flag key
 * @param fallback - Value to use while loading or if flag undefined
 */
export function useFlagWithFallback<T extends boolean | string>(
  flagKey: string,
  fallback?: T
): T {
  const posthog = usePostHog();
  const [value, setValue] = useState<T>(
    (fallback ?? getDefaultFlagValue(flagKey)) as T
  );

  useEffect(() => {
    // Check if already loaded
    const currentValue = posthog.getFeatureFlag(flagKey);
    if (currentValue !== undefined) {
      setValue(currentValue as T);
      return;
    }

    // Wait for flags to load
    const unsubscribe = posthog.onFeatureFlags(() => {
      const flagValue = posthog.getFeatureFlag(flagKey);
      if (flagValue !== undefined) {
        setValue(flagValue as T);
      }
    });

    return () => {
      // PostHog doesn't return unsubscribe function, but we can handle cleanup
    };
  }, [posthog, flagKey]);

  return value;
}

/**
 * Hook for tracking events with type safety
 *
 * @returns track function with proper typing
 */
export function useTrack() {
  const posthog = usePostHog();

  const track = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      posthog.capture(eventName, properties);
    },
    [posthog]
  );

  return track;
}

/**
 * Hook for identifying users
 *
 * @returns identify and reset functions
 */
export function useIdentify() {
  const posthog = usePostHog();

  const identify = useCallback(
    (userId: string, properties?: Record<string, unknown>) => {
      posthog.identify(userId, properties);
    },
    [posthog]
  );

  const reset = useCallback(() => {
    posthog.reset();
  }, [posthog]);

  return { identify, reset };
}

/**
 * Hook for getting all active feature flags
 *
 * @returns Record of all active flags
 */
export function useActiveFlags(): Record<string, boolean | string> {
  const posthog = usePostHog();
  const [flags, setFlags] = useState<Record<string, boolean | string>>({});

  useEffect(() => {
    const updateFlags = () => {
      const allFlags = posthog.featureFlags.getFlags();
      const flagValues: Record<string, boolean | string> = {};

      allFlags.forEach((flagKey) => {
        const value = posthog.getFeatureFlag(flagKey);
        if (value !== undefined) {
          flagValues[flagKey] = value;
        }
      });

      setFlags(flagValues);
    };

    // Initial load
    updateFlags();

    // Listen for flag updates
    posthog.onFeatureFlags(updateFlags);
  }, [posthog]);

  return flags;
}

/**
 * Hook for checking if user is in a specific cohort/segment
 *
 * Useful for conditional rendering based on user properties.
 *
 * @param propertyKey - User property to check
 * @param expectedValue - Expected value
 */
export function useUserSegment(
  propertyKey: string,
  expectedValue: unknown
): boolean {
  const posthog = usePostHog();
  const [isInSegment, setIsInSegment] = useState(false);

  useEffect(() => {
    // This would typically check against user properties
    // For now, return false until we implement property storage
    const properties = posthog.get_property("$stored_person_properties") || {};
    setIsInSegment(properties[propertyKey] === expectedValue);
  }, [posthog, propertyKey, expectedValue]);

  return isInSegment;
}
