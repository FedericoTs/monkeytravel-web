"use client";

import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * No PostHog provider is needed, and mounting one late remounted the app.
 *
 * posthog-js/react's hooks (lib/posthog/hooks.ts: useFlag, useExperiment,
 * usePostHog...) read a context whose DEFAULT value is the global posthog-js
 * instance, the same one instrumentation-client.ts initialises (no bootstrap).
 * So they work without a <PostHogProvider>, and they always did: until
 * 2026-09-25 this wrapper rendered plain children first and swapped in
 * <PostHogProvider client={posthog}> once PostHog had loaded, which handed the
 * hooks that very same instance. The swap changed the element at the root of
 * the app, so React unmounted and remounted EVERYTHING ~1-2 s into every page
 * load: local state lost, every mount effect run twice (on the trip page: 4
 * mounts per load together with the consent provider's own late wrap).
 *
 * Kept as a pass-through so the root layout's tree keeps one stable shape.
 * Do not reintroduce a provider that appears after the first render.
 */
export function PostHogProviderWrapper({ children }: ProvidersProps) {
  return <>{children}</>;
}
