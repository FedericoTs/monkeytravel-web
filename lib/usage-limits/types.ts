/**
 * Usage Limits Type Definitions
 */

/**
 * Subscription tier levels
 */
export type SubscriptionTier = "free" | "premium" | "enterprise";

/**
 * Types of usage limits that can be checked
 */
export type UsageLimitType =
  // AI limits (monthly)
  | "aiGenerations"
  | "aiRegenerations"
  | "aiAssistantMessages"
  // Places API limits (daily)
  | "placesAutocomplete"
  | "placesSearch"
  | "placesDetails";

/**
 * Period types for usage tracking
 */
export type UsagePeriodType = "monthly" | "daily";

/**
 * Limit configuration for a specific tier
 */
export interface TierLimits {
  aiGenerations: number; // -1 = unlimited
  aiRegenerations: number;
  aiAssistantMessages: number;
  placesAutocomplete: number;
  placesSearch: number;
  placesDetails: number;
}

/**
 * Result of a usage limit check
 */
export interface UsageCheckResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Number of remaining uses */
  remaining: number;
  /** Total limit for this period */
  limit: number;
  /** Amount already used */
  used: number;
  /** When the limit resets (ISO timestamp) */
  resetAt: string;
  /** User's subscription tier */
  tier: SubscriptionTier;
  /** Period type (monthly/daily) */
  periodType: UsagePeriodType;
  /** Human-readable message if not allowed */
  message?: string;
}

/**
 * Full usage statistics for a user
 */
export interface UserUsageStats {
  userId: string;
  tier: SubscriptionTier;
  subscriptionExpiresAt: string | null;

  // AI usage (monthly)
  aiGenerations: UsageCheckResult;
  aiRegenerations: UsageCheckResult;
  aiAssistantMessages: UsageCheckResult;

  // Places usage (daily)
  placesAutocomplete: UsageCheckResult;
  placesSearch: UsageCheckResult;
  placesDetails: UsageCheckResult;
}

/**
 * Database row for user_usage table
 */
export interface UserUsageRow {
  id: string;
  user_id: string;
  period_type: UsagePeriodType;
  period_key: string;
  ai_generations_used: number;
  ai_regenerations_used: number;
  ai_assistant_messages_used: number;
  ai_tokens_used: number;
  places_autocomplete_used: number;
  places_search_used: number;
  places_details_used: number;
  created_at: string;
  updated_at: string;
}

/**
 * Mapping from limit type to database column name
 */
export const LIMIT_TYPE_TO_COLUMN: Record<UsageLimitType, keyof UserUsageRow> = {
  aiGenerations: "ai_generations_used",
  aiRegenerations: "ai_regenerations_used",
  aiAssistantMessages: "ai_assistant_messages_used",
  placesAutocomplete: "places_autocomplete_used",
  placesSearch: "places_search_used",
  placesDetails: "places_details_used",
};

/**
 * Mapping from limit type to period type
 */
export const LIMIT_TYPE_TO_PERIOD: Record<UsageLimitType, UsagePeriodType> = {
  aiGenerations: "monthly",
  aiRegenerations: "monthly",
  aiAssistantMessages: "daily",
  placesAutocomplete: "daily",
  placesSearch: "daily",
  placesDetails: "daily",
};
