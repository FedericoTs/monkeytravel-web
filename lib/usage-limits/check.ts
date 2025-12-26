/**
 * Usage Limit Checking and Tracking
 *
 * Core functions for checking and incrementing usage limits.
 */

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  type SubscriptionTier,
  type UsageLimitType,
  type UsagePeriodType,
  type UsageCheckResult,
  type UserUsageStats,
  type TierLimits,
  LIMIT_TYPE_TO_COLUMN,
  LIMIT_TYPE_TO_PERIOD,
} from "./types";
import {
  TIER_LIMITS,
  SUBSCRIPTION_GRACE_PERIOD_DAYS,
  LIMIT_DISPLAY_NAMES,
  isUnlimited,
} from "./config";
import { TIER_BENEFITS } from "@/lib/bananas/config";
import type { ReferralTierLevel } from "@/types/bananas";

/**
 * Custom limits for a user (from early access code redemption)
 */
interface CustomLimitsResult {
  hasCustomLimits: boolean;
  limits: Partial<TierLimits> | null;
}

/**
 * Get referral tier bonus for a specific limit type
 * Referral bonuses are ADDITIVE to subscription tier limits
 */
function getReferralTierBonus(
  referralTier: ReferralTierLevel,
  limitType: UsageLimitType
): number {
  const benefits = TIER_BENEFITS[referralTier];

  switch (limitType) {
    case "aiGenerations":
      return benefits.aiGenerationsBonus;
    case "aiRegenerations":
      return benefits.aiRegenerationsBonus;
    default:
      return 0; // No bonus for other limit types
  }
}

/**
 * Get user's referral tier from database
 */
async function getUserReferralTier(userId: string): Promise<ReferralTierLevel> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("users")
      .select("referral_tier")
      .eq("id", userId)
      .single();

    return (data?.referral_tier ?? 0) as ReferralTierLevel;
  } catch {
    return 0;
  }
}

/**
 * Get custom limits for a user who redeemed an early access code
 */
async function getEarlyAccessLimits(userId: string): Promise<CustomLimitsResult> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("user_tester_access")
      .select("ai_generations_limit, ai_regenerations_limit, ai_assistant_limit, expires_at")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return { hasCustomLimits: false, limits: null };
    }

    // Check if access has expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { hasCustomLimits: false, limits: null };
    }

    // Build limits object from the explicit columns
    const limits: Partial<TierLimits> = {};

    if (data.ai_generations_limit !== null) {
      limits.aiGenerations = data.ai_generations_limit;
    }
    if (data.ai_regenerations_limit !== null) {
      limits.aiRegenerations = data.ai_regenerations_limit;
    }
    if (data.ai_assistant_limit !== null) {
      limits.aiAssistantMessages = data.ai_assistant_limit;
    }

    // If any limits are set, return them
    if (Object.keys(limits).length > 0) {
      return { hasCustomLimits: true, limits };
    }

    // Early access user without specific limits - they get premium tier by default
    return { hasCustomLimits: true, limits: null };
  } catch {
    return { hasCustomLimits: false, limits: null };
  }
}

/**
 * Get the current period key for a given period type
 * Monthly: "2025-01"
 * Daily: "2025-01-06"
 */
export function getCurrentPeriodKey(periodType: UsagePeriodType): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  if (periodType === "monthly") {
    return `${year}-${month}`;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Get the reset timestamp for a period
 */
export function getPeriodResetAt(periodType: UsagePeriodType): string {
  const now = new Date();

  if (periodType === "monthly") {
    // First day of next month at midnight UTC
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
  }

  // Tomorrow at midnight UTC
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return tomorrow.toISOString();
}

/**
 * Get user's subscription tier from database
 * Checks expiration and grace period
 */
export async function getUserTier(userId: string, userEmail?: string | null): Promise<SubscriptionTier> {
  // Admin check first (bypass all limits)
  if (userEmail && isAdmin(userEmail)) {
    return "enterprise"; // Admins get enterprise tier (unlimited)
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("users")
    .select("subscription_tier, subscription_expires_at, email")
    .eq("id", userId)
    .single();

  if (error || !data) {
    console.warn("[UsageLimits] Could not fetch user tier:", error?.message);
    return "free";
  }

  // Admin check by email from database
  if (data.email && isAdmin(data.email)) {
    return "enterprise";
  }

  const tier = (data.subscription_tier as SubscriptionTier) || "free";

  // Check if subscription has expired
  if (tier !== "free" && data.subscription_expires_at) {
    const expiresAt = new Date(data.subscription_expires_at);
    const now = new Date();
    const gracePeriodEnd = new Date(expiresAt);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + SUBSCRIPTION_GRACE_PERIOD_DAYS);

    if (now > gracePeriodEnd) {
      // Past grace period, revert to free
      console.log(`[UsageLimits] User ${userId} subscription expired, reverting to free`);
      return "free";
    }
  }

  return tier;
}

/**
 * Get current usage for a user and limit type
 */
async function getCurrentUsage(
  userId: string,
  limitType: UsageLimitType
): Promise<number> {
  const supabase = await createClient();
  const periodType = LIMIT_TYPE_TO_PERIOD[limitType];
  const periodKey = getCurrentPeriodKey(periodType);
  const columnName = LIMIT_TYPE_TO_COLUMN[limitType];

  const { data, error } = await supabase
    .from("user_usage")
    .select(columnName)
    .eq("user_id", userId)
    .eq("period_type", periodType)
    .eq("period_key", periodKey)
    .single();

  if (error || !data) {
    // No usage record yet = 0 usage
    return 0;
  }

  // Type assertion to access dynamic column - we know columnName is a valid column key
  return ((data as Record<string, unknown>)[columnName] as number) || 0;
}

/**
 * Check if a user can perform an action based on their usage limits
 *
 * @param userId - User ID to check
 * @param limitType - Type of limit to check
 * @param userEmail - Optional user email for admin bypass
 * @returns UsageCheckResult with allowed status and usage details
 */
export async function checkUsageLimit(
  userId: string,
  limitType: UsageLimitType,
  userEmail?: string | null
): Promise<UsageCheckResult> {
  try {
    const periodType = LIMIT_TYPE_TO_PERIOD[limitType];
    const resetAt = getPeriodResetAt(periodType);

    // Check for early access user with custom limits
    const earlyAccessLimits = await getEarlyAccessLimits(userId);

    if (earlyAccessLimits.hasCustomLimits) {
      // Early access user found
      if (earlyAccessLimits.limits && earlyAccessLimits.limits[limitType] !== undefined) {
        // Use custom limit for this specific type
        const customLimit = earlyAccessLimits.limits[limitType] as number;

        // Unlimited check
        if (isUnlimited(customLimit)) {
          return {
            allowed: true,
            remaining: -1,
            limit: -1,
            used: 0,
            resetAt,
            tier: "premium", // Early access users show as premium
            periodType,
          };
        }

        // Get current usage
        const used = await getCurrentUsage(userId, limitType);
        const remaining = Math.max(0, customLimit - used);
        const allowed = used < customLimit;

        return {
          allowed,
          remaining,
          limit: customLimit,
          used,
          resetAt,
          tier: "premium",
          periodType,
          message: allowed
            ? undefined
            : `You've reached your ${LIMIT_DISPLAY_NAMES[limitType]} limit for this ${periodType === "monthly" ? "month" : "day"}.`,
        };
      } else {
        // Early access user without specific custom limits - give unlimited access
        return {
          allowed: true,
          remaining: -1,
          limit: -1,
          used: 0,
          resetAt,
          tier: "premium",
          periodType,
        };
      }
    }

    // No early access - use normal tier-based limits
    const tier = await getUserTier(userId, userEmail);
    const baseLimit = TIER_LIMITS[tier][limitType];

    // Unlimited check (before adding bonus)
    if (isUnlimited(baseLimit)) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        used: 0, // Don't bother querying for unlimited
        resetAt,
        tier,
        periodType,
      };
    }

    // Get referral tier bonus (ADDITIVE to subscription tier)
    const referralTier = await getUserReferralTier(userId);
    const referralBonus = getReferralTierBonus(referralTier, limitType);

    // Check if referral bonus gives unlimited (-1)
    if (referralBonus === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        used: 0,
        resetAt,
        tier,
        periodType,
      };
    }

    // Calculate effective limit with bonus
    const effectiveLimit = baseLimit + referralBonus;

    // Get current usage
    const used = await getCurrentUsage(userId, limitType);
    const remaining = Math.max(0, effectiveLimit - used);
    const allowed = used < effectiveLimit;

    return {
      allowed,
      remaining,
      limit: effectiveLimit,
      used,
      resetAt,
      tier,
      periodType,
      message: allowed
        ? undefined
        : referralBonus > 0
          ? `You've reached your ${LIMIT_DISPLAY_NAMES[limitType]} limit for this ${periodType === "monthly" ? "month" : "day"}. Invite more friends to unlock additional usage!`
          : `You've reached your ${LIMIT_DISPLAY_NAMES[limitType]} limit for this ${periodType === "monthly" ? "month" : "day"}. Upgrade to Premium for unlimited access or invite friends for bonus usage.`,
    };
  } catch (error) {
    console.error("[UsageLimits] Error checking limit:", error);
    // Fail-open: allow the request if we can't check limits
    // This prevents service disruption due to DB issues
    return {
      allowed: true,
      remaining: -1,
      limit: -1,
      used: 0,
      resetAt: getPeriodResetAt(LIMIT_TYPE_TO_PERIOD[limitType]),
      tier: "free",
      periodType: LIMIT_TYPE_TO_PERIOD[limitType],
    };
  }
}

/**
 * Increment usage counter after a successful action
 *
 * @param userId - User ID
 * @param limitType - Type of limit to increment
 * @param amount - Amount to increment (default: 1)
 * @returns New usage count
 */
export async function incrementUsage(
  userId: string,
  limitType: UsageLimitType,
  amount: number = 1
): Promise<number> {
  try {
    const supabase = await createClient();
    const periodType = LIMIT_TYPE_TO_PERIOD[limitType];
    const periodKey = getCurrentPeriodKey(periodType);
    const columnName = LIMIT_TYPE_TO_COLUMN[limitType];

    // Use upsert for atomic increment
    // First, ensure the row exists
    await supabase.from("user_usage").upsert(
      {
        user_id: userId,
        period_type: periodType,
        period_key: periodKey,
      },
      {
        onConflict: "user_id,period_type,period_key",
        ignoreDuplicates: true,
      }
    );

    // Then increment the specific column
    // We use RPC for atomic increment
    const { data, error } = await supabase.rpc("increment_usage", {
      p_user_id: userId,
      p_period_type: periodType,
      p_period_key: periodKey,
      p_column_name: columnName,
      p_amount: amount,
    });

    if (error) {
      console.error("[UsageLimits] Error incrementing usage:", error);
      // Fallback: try direct update
      const { data: fallbackData } = await supabase
        .from("user_usage")
        .select(columnName)
        .eq("user_id", userId)
        .eq("period_type", periodType)
        .eq("period_key", periodKey)
        .single();

      return (((fallbackData as Record<string, unknown> | null)?.[columnName] as number) || 0) + amount;
    }

    return data as number;
  } catch (error) {
    console.error("[UsageLimits] Error in incrementUsage:", error);
    return 0;
  }
}

/**
 * Get full usage statistics for a user
 * Used for the usage dashboard
 */
export async function getUserUsageStats(
  userId: string,
  userEmail?: string | null
): Promise<UserUsageStats> {
  const tier = await getUserTier(userId, userEmail);
  const supabase = await createClient();

  // Get subscription expiry
  const { data: userData } = await supabase
    .from("users")
    .select("subscription_expires_at")
    .eq("id", userId)
    .single();

  // Check all limit types
  const limitTypes: UsageLimitType[] = [
    "aiGenerations",
    "aiRegenerations",
    "aiAssistantMessages",
    "placesAutocomplete",
    "placesSearch",
    "placesDetails",
  ];

  const results = await Promise.all(
    limitTypes.map((type) => checkUsageLimit(userId, type, userEmail))
  );

  return {
    userId,
    tier,
    subscriptionExpiresAt: userData?.subscription_expires_at || null,
    aiGenerations: results[0],
    aiRegenerations: results[1],
    aiAssistantMessages: results[2],
    placesAutocomplete: results[3],
    placesSearch: results[4],
    placesDetails: results[5],
  };
}

/**
 * Check if user is on free tier (for upgrade prompts)
 */
export async function isFreeTier(userId: string, userEmail?: string | null): Promise<boolean> {
  const tier = await getUserTier(userId, userEmail);
  return tier === "free";
}

/**
 * Batch check multiple limits at once (optimization)
 */
export async function checkMultipleLimits(
  userId: string,
  limitTypes: UsageLimitType[],
  userEmail?: string | null
): Promise<Record<UsageLimitType, UsageCheckResult>> {
  const results = await Promise.all(
    limitTypes.map((type) => checkUsageLimit(userId, type, userEmail))
  );

  const resultMap: Partial<Record<UsageLimitType, UsageCheckResult>> = {};
  limitTypes.forEach((type, index) => {
    resultMap[type] = results[index];
  });

  return resultMap as Record<UsageLimitType, UsageCheckResult>;
}
