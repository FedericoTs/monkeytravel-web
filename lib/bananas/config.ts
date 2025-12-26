/**
 * Bananas System Configuration
 *
 * All earning rates, tier definitions, and system constants.
 */

import type { ReferralTierLevel, TierBenefits } from '@/types/bananas';

// =============================================================================
// EARNING RATES
// =============================================================================

/**
 * Base earning rates (before tier multipliers)
 */
export const BANANA_EARNING_RATES = {
  referral: 50,           // Per successful referral
  tripComplete: 10,       // Per completed trip
  firstTrip: 25,          // Bonus for first trip (one-time)
  signupBonus: 0,         // No signup bonus (earn through referrals)
  review: 5,              // Per review left
  collaboration: 50,      // Collaborator counted as referral
} as const;

/**
 * Tier-based earning multipliers
 */
export const TIER_EARNING_MULTIPLIERS: Record<ReferralTierLevel, number> = {
  0: 1.0,    // Base rate
  1: 1.2,    // +20% at Tier 1
  2: 1.5,    // +50% at Tier 2
  3: 2.0,    // +100% at Tier 3
};

// =============================================================================
// TIER THRESHOLDS
// =============================================================================

/**
 * Number of referrals needed to unlock each tier
 */
export const TIER_THRESHOLDS: Record<ReferralTierLevel, number> = {
  0: 0,
  1: 3,
  2: 6,
  3: 10,
};

/**
 * One-time bonus bananas awarded when unlocking a tier
 */
export const TIER_UNLOCK_BONUSES: Record<ReferralTierLevel, number> = {
  0: 0,
  1: 100,
  2: 200,
  3: 500,
};

// =============================================================================
// TIER BENEFITS
// =============================================================================

/**
 * Benefits at each tier level
 * These bonuses are ADDITIVE to base subscription tier limits
 */
export const TIER_BENEFITS: Record<ReferralTierLevel, TierBenefits> = {
  0: {
    aiGenerationsBonus: 0,
    aiRegenerationsBonus: 0,
    bananasPerReferral: 50,
    tierBonus: 0,
    hasTemplateAccess: false,
    templateCount: 0,
    hasPrioritySupport: false,
    hasEarlyAccess: false,
  },
  1: {
    aiGenerationsBonus: 2,        // +2 AI generations/month
    aiRegenerationsBonus: 5,      // +5 regenerations/month
    bananasPerReferral: 60,       // +20% bananas per referral
    tierBonus: 100,
    hasTemplateAccess: true,
    templateCount: 3,
    hasPrioritySupport: false,
    hasEarlyAccess: false,
  },
  2: {
    aiGenerationsBonus: 5,        // +5 AI generations/month
    aiRegenerationsBonus: 15,     // +15 regenerations/month
    bananasPerReferral: 75,       // +50% bananas per referral
    tierBonus: 200,
    hasTemplateAccess: true,
    templateCount: 10,
    hasPrioritySupport: true,
    hasEarlyAccess: false,
  },
  3: {
    aiGenerationsBonus: 12,       // +12 AI generations/month (15 total for free)
    aiRegenerationsBonus: -1,     // Unlimited regenerations
    bananasPerReferral: 100,      // +100% bananas per referral
    tierBonus: 500,
    hasTemplateAccess: true,
    templateCount: -1,            // All templates
    hasPrioritySupport: true,
    hasEarlyAccess: true,
  },
};

// =============================================================================
// TIER METADATA
// =============================================================================

export const TIER_NAMES: Record<ReferralTierLevel, string> = {
  0: 'Traveler',
  1: 'Explorer',
  2: 'Ambassador',
  3: 'Champion',
};

export const TIER_EMOJIS: Record<ReferralTierLevel, string> = {
  0: '',
  1: '🌟',
  2: '🔥',
  3: '👑',
};

export const TIER_COLORS: Record<ReferralTierLevel, string> = {
  0: 'slate',
  1: 'amber',
  2: 'orange',
  3: 'purple',
};

/**
 * Badge image paths for each tier
 * Tier 0 has no badge image
 */
export const TIER_BADGE_IMAGES: Record<ReferralTierLevel, string | null> = {
  0: null,
  1: '/images/badges/explorer.png',
  2: '/images/badges/ambassador.png',
  3: '/images/badges/champion.png',
};

export const TIER_DESCRIPTIONS: Record<ReferralTierLevel, string> = {
  0: 'Start inviting friends to unlock rewards!',
  1: 'You\'re on a roll! Keep inviting for more perks.',
  2: 'Travel Ambassador! Your friends love MonkeyTravel.',
  3: 'Champion status unlocked! Maximum rewards.',
};

// =============================================================================
// EXPIRATION
// =============================================================================

export const BANANA_EXPIRATION_MONTHS = 12;
export const EXPIRATION_WARNING_DAYS = 30;

// =============================================================================
// SPENDING
// =============================================================================

/**
 * Feature codes that can be unlocked with banana redemptions
 */
export const REDEEMABLE_FEATURES = {
  EXTRA_AI_GENERATION: 'extra_ai_generation',
  PRIORITY_AI_QUEUE: 'priority_ai_queue',
  PREMIUM_TEMPLATES: 'premium_templates',
  PREMIUM_TRIAL: 'premium_trial',
} as const;

// =============================================================================
// FRAUD PREVENTION
// =============================================================================

export const FRAUD_THRESHOLDS = {
  sameIpScore: 30,
  similarEmailScore: 20,
  newAccountScore: 15,
  noEngagementScore: 25,
  vpnScore: 10,
  blockThreshold: 50,
  reviewThreshold: 30,
};

export const MAX_REFERRALS_PER_DAY = 5;
export const MIN_ACCOUNT_AGE_HOURS = 24;
export const CLAWBACK_WINDOW_DAYS = 7;

// =============================================================================
// LEADERBOARD
// =============================================================================

export const LEADERBOARD_SIZE = 10;
export const LEADERBOARD_REFRESH_MINUTES = 15;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the tier level for a given conversion count
 */
export function getTierForConversions(conversions: number): ReferralTierLevel {
  if (conversions >= TIER_THRESHOLDS[3]) return 3;
  if (conversions >= TIER_THRESHOLDS[2]) return 2;
  if (conversions >= TIER_THRESHOLDS[1]) return 1;
  return 0;
}

/**
 * Get conversions needed for next tier
 */
export function getConversionsToNextTier(currentConversions: number): number {
  const currentTier = getTierForConversions(currentConversions);
  if (currentTier === 3) return 0;

  const nextTierThreshold = TIER_THRESHOLDS[(currentTier + 1) as ReferralTierLevel];
  return nextTierThreshold - currentConversions;
}

/**
 * Get next tier threshold
 */
export function getNextTierThreshold(currentConversions: number): number {
  const currentTier = getTierForConversions(currentConversions);
  if (currentTier === 3) return TIER_THRESHOLDS[3];
  return TIER_THRESHOLDS[(currentTier + 1) as ReferralTierLevel];
}

/**
 * Calculate bananas earned for a referral based on tier
 */
export function getBananasForReferral(tier: ReferralTierLevel): number {
  return TIER_BENEFITS[tier].bananasPerReferral;
}

/**
 * Check if a limit value means unlimited
 */
export function isUnlimited(value: number): boolean {
  return value === -1;
}

/**
 * Get tier badge info for display
 */
export function getTierBadgeInfo(tier: ReferralTierLevel, unlockedAt?: string) {
  return {
    tier,
    name: TIER_NAMES[tier],
    emoji: TIER_EMOJIS[tier],
    color: TIER_COLORS[tier],
    description: TIER_DESCRIPTIONS[tier],
    unlocked: tier > 0,
    unlockedAt,
  };
}

/**
 * Calculate progress percentage to next tier
 */
export function getTierProgress(conversions: number): number {
  const currentTier = getTierForConversions(conversions);
  if (currentTier === 3) return 100;

  const currentThreshold = TIER_THRESHOLDS[currentTier];
  const nextThreshold = TIER_THRESHOLDS[(currentTier + 1) as ReferralTierLevel];
  const progressInTier = conversions - currentThreshold;
  const tierRange = nextThreshold - currentThreshold;

  return Math.round((progressInTier / tierRange) * 100);
}
