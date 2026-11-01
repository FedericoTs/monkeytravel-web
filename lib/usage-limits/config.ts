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
    //
    // "Free" stays honest by giving MORE, not by walking back the marketing:
    // one generation is a single gemini-2.5-flash call, and 30/mo is far
    // above what real users generate, so the cap is an anti-scripting
    // ceiling rather than a product limit, while premium (unlimited, -1)
    // stays sellable and the cost backstop survives a viral spike. Enforced
    // via checkUsageLimit → TIER_LIMITS (NOT unlimited).
    aiGenerations: 30, // 30 trips per month
    aiRegenerations: 100, // 100 activity regenerations per month
    aiAssistantMessages: 100, // 100 AI assistant messages per day

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
 * Check if a limit is unlimited (-1)
 */
export function isUnlimited(limit: number): boolean {
  return limit === -1;
}
