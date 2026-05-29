/**
 * PostHog Integration Module
 *
 * Provides analytics, feature flags, and A/B testing capabilities.
 *
 * @example Client-side usage:
 * ```typescript
 * import { useFlag, useExperiment, useTrack } from '@/lib/posthog'
 *
 * function Component() {
 *   const { enabled } = useFlag('new-feature')
 *   const { variant } = useExperiment('pricing-test')
 *   const track = useTrack()
 *
 *   return enabled ? <NewFeature /> : <OldFeature />
 * }
 * ```
 *
 * @example Server-side usage:
 * ```typescript
 * import { getServerFeatureFlag } from '@/lib/posthog/server'
 *
 * async function getPageProps() {
 *   const showNewPricing = await getServerFeatureFlag(userId, 'new-pricing')
 *   return { showNewPricing }
 * }
 * ```
 */

// Client-side exports
// Note: bare `posthog` instance is no longer re-exported (perf task #179)
// — it leaked the SDK into the shared chunk. Use the lazy `capture()` /
// `captureXxx()` helpers from ./events, or grab `window.posthog` at the
// rare call site that genuinely needs the raw client.
export { initPostHog, isPostHogInitialized } from "./client";
export {
  identifyUser,
  resetUser,
  aliasUser,
  aliasAnonToUser,
  identify,
  updateUserProperties,
  setOnceUserProperty,
  getDistinctId,
  type PostHogUserProperties,
  type IdentifyProperties,
} from "./identify";

// Hooks
export {
  useFlag,
  useExperiment,
  useFlagWithFallback,
  useTrack,
  useIdentify,
  useActiveFlags,
  useUserSegment,
} from "./hooks";

// Events
export * from "./events";

// Flags
export * from "./flags";

// LLM Analytics - exported separately from "./llm-analytics" for server-only use
// Do not import here to avoid bundling server code in client components

// Re-export PostHog React components
export {
  PostHogProvider,
  usePostHog,
  useFeatureFlagEnabled,
  useFeatureFlagVariantKey,
  useFeatureFlagPayload,
  PostHogFeature,
} from "posthog-js/react";
