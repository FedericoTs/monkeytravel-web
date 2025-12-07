/**
 * Usage Limits Configuration
 *
 * Defines the limits for each subscription tier.
 * Use -1 for unlimited.
 */

import type { SubscriptionTier, TierLimits } from "./types";

/**
 * Tier limit configurations
 *
 * Free tier: Limited usage to control costs
 * Premium tier: Unlimited usage for paying customers
 * Enterprise tier: Same as premium (reserved for future B2B)
 */
export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    // AI limits (monthly) - Primary cost driver
    aiGenerations: 3, // 3 trips per month
    aiRegenerations: 10, // 10 activity regenerations per month
    aiAssistantMessages: 20, // 20 AI assistant messages per day

    // Places API limits (daily) - Secondary cost driver
    placesAutocomplete: 100, // 100 autocomplete requests per day
    placesSearch: 50, // 50 place searches per day
    placesDetails: 30, // 30 place details requests per day
  },

  premium: {
    // Unlimited for premium users
    aiGenerations: -1,
    aiRegenerations: -1,
    aiAssistantMessages: -1,
    placesAutocomplete: -1,
    placesSearch: -1,
    placesDetails: -1,
  },

  enterprise: {
    // Same as premium for now
    aiGenerations: -1,
    aiRegenerations: -1,
    aiAssistantMessages: -1,
    placesAutocomplete: -1,
    placesSearch: -1,
    placesDetails: -1,
  },
};

/**
 * Grace period in days after subscription expires
 * User retains premium limits during this period
 */
export const SUBSCRIPTION_GRACE_PERIOD_DAYS = 3;

/**
 * Human-readable limit names for error messages
 */
export const LIMIT_DISPLAY_NAMES: Record<keyof TierLimits, string> = {
  aiGenerations: "trip generation",
  aiRegenerations: "activity regeneration",
  aiAssistantMessages: "AI assistant message",
  placesAutocomplete: "destination search",
  placesSearch: "place search",
  placesDetails: "place detail",
};

/**
 * Get the limit for a specific tier and limit type
 */
export function getLimit(tier: SubscriptionTier, limitType: keyof TierLimits): number {
  return TIER_LIMITS[tier][limitType];
}

/**
 * Check if a limit is unlimited (-1)
 */
export function isUnlimited(limit: number): boolean {
  return limit === -1;
}
