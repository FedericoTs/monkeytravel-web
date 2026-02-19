"use client";

import { type ReactNode, useEffect, useState, type ComponentType } from "react";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * PostHog Provider Wrapper
 *
 * PERFORMANCE: PostHog is NOT imported statically to avoid adding ~80-120 KB
 * to the initial JS bundle. Instead, both posthog-js and PostHogProvider are
 * dynamically imported after the page becomes idle.
 *
 * Children render immediately without PostHog context. Once PostHog loads,
 * the provider wraps children and React hooks (usePostHog, useFlag, etc.)
 * become functional. Components that use PostHog hooks handle the undefined
 * state gracefully via their isLoading checks.
 *
 * @see /instrumentation-client.ts for PostHog initialization
 */
export function PostHogProviderWrapper({ children }: ProvidersProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [provider, setProvider] = useState<{
    Component: ComponentType<any>;
    client: any;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | undefined;

    const loadPostHog = async () => {
      try {
        const [{ default: posthog }, { PostHogProvider }] = await Promise.all([
          import("posthog-js"),
          import("posthog-js/react"),
        ]);

        if (cancelled) return;

        // If PostHog is already initialized (by instrumentation-client.ts), mount immediately
        if (posthog.__loaded) {
          setProvider({ Component: PostHogProvider, client: posthog });
          return;
        }

        // Poll until initialized (instrumentation-client.ts defers init via requestIdleCallback)
        pollInterval = setInterval(() => {
          if (posthog.__loaded && !cancelled) {
            clearInterval(pollInterval);
            setProvider({ Component: PostHogProvider, client: posthog });
          }
        }, 200);

        // Stop polling after 15s (user may not have given consent)
        setTimeout(() => {
          if (pollInterval) clearInterval(pollInterval);
        }, 15000);
      } catch (err) {
        console.warn("[PostHog] Failed to load provider:", err);
      }
    };

    // Defer loading to after initial paint
    if ("requestIdleCallback" in window) {
      const idleId = requestIdleCallback(() => loadPostHog(), { timeout: 4000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(idleId);
        if (pollInterval) clearInterval(pollInterval);
      };
    } else {
      const timeout = setTimeout(loadPostHog, 2000);
      return () => {
        cancelled = true;
        clearTimeout(timeout);
        if (pollInterval) clearInterval(pollInterval);
      };
    }
  }, []);

  // Render with PostHog provider once loaded, plain children until then
  if (provider) {
    const { Component, client } = provider;
    return <Component client={client}>{children}</Component>;
  }

  return <>{children}</>;
}

/**
 * Combined providers for the application
 *
 * Wraps all third-party providers in a single component for cleaner layout.
 * Add new providers here as needed.
 */
export default function Providers({ children }: ProvidersProps) {
  return <PostHogProviderWrapper>{children}</PostHogProviderWrapper>;
}
