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

// Client-side exports. The raw `posthog` instance is not re-exported (it
// pulls the SDK into the shared chunk); use the lazy helpers from ./events.
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
export { useFlag } from "./hooks";

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
