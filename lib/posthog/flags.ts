/**
 * Feature Flag Keys
 *
 * Centralized definitions for all feature flags used in the app.
 * This ensures type safety and easy discoverability.
 */

// ============================================================================
// EXPERIMENT FLAGS (A/B Tests)
// ============================================================================

/**
 * Pricing tier experiment
 * Tests different price points for Pro subscription
 */
export const FLAG_PRICING_TIER = "pricing-tier-test";
export type PricingTierVariant = "control" | "high-price" | "low-price";

/**
 * Trial duration experiment
 * Tests different trial lengths for conversion optimization
 */
export const FLAG_TRIAL_DURATION = "trial-duration";
export type TrialDurationVariant = "7-days" | "14-days" | "3-days";

/**
 * Share modal timing experiment
 * Tests when to show the share prompt after trip save
 * @deprecated Use FLAG_SHARE_MODAL_TIMING_EXP for the active experiment
 */
export const FLAG_SHARE_MODAL_DELAY = "share-modal-delay";
export type ShareModalDelayVariant = "immediate" | "delayed" | "on-scroll";

/**
 * Share modal timing experiment (Active A/B Test)
 * Tests delay before showing share modal after trip save
 * Hypothesis: Brief delay lets users appreciate their trip, increasing shares
 *
 * Variants:
 * - control: Show immediately (0s)
 * - delayed-2s: Show after 2 seconds
 * - delayed-5s: Show after 5 seconds
 */
export const FLAG_SHARE_MODAL_TIMING_EXP = "share-modal-timing-exp";
export type ShareModalTimingVariant = "control" | "delayed-2s" | "delayed-5s";

/**
 * Onboarding steps experiment
 * Tests reduced onboarding for faster activation
 */
export const FLAG_ONBOARDING_STEPS = "onboarding-steps";
export type OnboardingStepsVariant = "4-steps" | "3-steps" | "2-steps";

/**
 * Upgrade prompt style experiment
 * Tests different upgrade prompt presentations
 */
export const FLAG_UPGRADE_PROMPT_STYLE = "upgrade-prompt-style";
export type UpgradePromptStyleVariant = "modal" | "banner" | "toast";

/**
 * Referral messaging experiment
 * Tests different referral incentive copy
 */
export const FLAG_REFERRAL_MESSAGING = "referral-messaging";
export type ReferralMessagingVariant = "earn-rewards" | "help-friends" | "unlock-features";

// ============================================================================
// FEATURE ROLLOUT FLAGS (Boolean)
// ============================================================================

/**
 * New AI features rollout
 * Gradually enable new AI capabilities
 */
export const FLAG_NEW_AI_FEATURES = "new-ai-features";

/**
 * Collaboration v2
 * New collaboration features with proposal voting
 */
export const FLAG_COLLABORATION_V2 = "collaboration-v2";

/**
 * Session replay
 * Enable PostHog session recording
 */
export const FLAG_SESSION_REPLAY = "session-replay";

/**
 * Enhanced analytics
 * Enable detailed user journey tracking
 */
export const FLAG_ENHANCED_ANALYTICS = "enhanced-analytics";

/**
 * Premium templates
 * Show premium trip templates
 */
export const FLAG_PREMIUM_TEMPLATES = "premium-templates";

/**
 * Enhanced Booking Panel
 * Show Travelpayouts partners (Booking.com, Trip.com, Klook, etc.)
 * instead of original affiliates (Aviasales, Hotellook)
 */
export const FLAG_ENHANCED_BOOKING = "enhanced-booking-panel";

// ============================================================================
// FLAG CONFIGURATION
// ============================================================================

/**
 * Default values for flags (used as fallbacks)
 */
export const FLAG_DEFAULTS: Record<string, boolean | string> = {
  [FLAG_PRICING_TIER]: "control",
  [FLAG_TRIAL_DURATION]: "7-days",
  [FLAG_SHARE_MODAL_DELAY]: "immediate",
  [FLAG_SHARE_MODAL_TIMING_EXP]: "control",
  [FLAG_ONBOARDING_STEPS]: "4-steps",
  [FLAG_UPGRADE_PROMPT_STYLE]: "modal",
  [FLAG_REFERRAL_MESSAGING]: "earn-rewards",
  [FLAG_NEW_AI_FEATURES]: false,
  [FLAG_COLLABORATION_V2]: true,
  [FLAG_SESSION_REPLAY]: false,
  [FLAG_ENHANCED_ANALYTICS]: true,
  [FLAG_PREMIUM_TEMPLATES]: false,
  [FLAG_ENHANCED_BOOKING]: false, // Start disabled, enable via PostHog
};

/**
 * Get default value for a flag
 */
export function getDefaultFlagValue(flagKey: string): boolean | string {
  return FLAG_DEFAULTS[flagKey] ?? false;
}
