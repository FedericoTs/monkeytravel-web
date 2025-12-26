"use client";

import type { ReactNode } from "react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * PostHog Provider Wrapper
 *
 * Provides the PostHog context to all child components.
 *
 * Note: PostHog is initialized in instrumentation-client.ts (Next.js 15.3+ pattern).
 * This provider only wraps the app with PostHogProvider for React hooks access.
 *
 * Features enabled:
 * - Automatic pageview tracking (history_change mode)
 * - Session recording
 * - Feature flags
 * - Autocapture
 *
 * @see https://posthog.com/docs/libraries/next-js
 * @see /instrumentation-client.ts for initialization
 */
export function PostHogProviderWrapper({ children }: ProvidersProps) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
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
