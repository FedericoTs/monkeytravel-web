/**
 * Referral Tier Operations
 *
 * Functions for checking, unlocking, and managing referral tiers.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  ReferralTierLevel,
  ReferralTierInfo,
  TierBadgeInfo,
  ReferralTierRow,
} from '@/types/bananas';
import {
  TIER_THRESHOLDS,
  TIER_NAMES,
  TIER_EMOJIS,
  TIER_BENEFITS,
  getTierForConversions,
  getConversionsToNextTier,
  getNextTierThreshold,
} from './config';

/**
 * Get user's referral tier info
 */
export async function getReferralTierInfo(
  supabase: SupabaseClient,
  userId: string
): Promise<ReferralTierInfo> {
  // Get tier record
  const { data: tierData } = await supabase
    .from('referral_tiers')
    .select('*')
    .eq('user_id', userId)
    .single();

  // Get conversion count from referral_codes
  const { data: referralCode } = await supabase
    .from('referral_codes')
    .select('total_conversions')
    .eq('user_id', userId)
    .single();

  const conversions = referralCode?.total_conversions ?? 0;
  const tier = tierData as ReferralTierRow | null;

  const currentTier = (tier?.current_tier ?? getTierForConversions(conversions)) as ReferralTierLevel;
  const highestTier = (tier?.highest_tier_achieved ?? currentTier) as ReferralTierLevel;

  return {
    currentTier,
    highestTierAchieved: highestTier,
    lifetimeConversions: tier?.lifetime_conversions ?? conversions,
    conversionsToNextTier: getConversionsToNextTier(conversions),
    nextTierAt: getNextTierThreshold(conversions),
    tier1UnlockedAt: tier?.tier_1_unlocked_at ?? undefined,
    tier2UnlockedAt: tier?.tier_2_unlocked_at ?? undefined,
    tier3UnlockedAt: tier?.tier_3_unlocked_at ?? undefined,
  };
}

/**
 * Get all tier badges with unlock status
 */
export async function getTierBadges(
  supabase: SupabaseClient,
  userId: string
): Promise<TierBadgeInfo[]> {
  const tierInfo = await getReferralTierInfo(supabase, userId);

  const badges: TierBadgeInfo[] = [];

  // Only include tiers 1-3 (tier 0 has no badge)
  for (let tier = 1; tier <= 3; tier++) {
    const t = tier as ReferralTierLevel;
    const unlocked = tierInfo.highestTierAchieved >= t;
    let unlockedAt: string | undefined;

    if (t === 1) unlockedAt = tierInfo.tier1UnlockedAt;
    else if (t === 2) unlockedAt = tierInfo.tier2UnlockedAt;
    else if (t === 3) unlockedAt = tierInfo.tier3UnlockedAt;

    badges.push({
      tier: t,
      name: TIER_NAMES[t],
      emoji: TIER_EMOJIS[t],
      unlocked,
      unlockedAt,
    });
  }

  return badges;
}

/**
 * Check and unlock tier if eligible
 * Returns tier info and whether a new tier was unlocked
 */
export async function checkAndUnlockTier(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  tierInfo: ReferralTierInfo;
  tierUnlocked: boolean;
  bonusBananas: number;
}> {
  const { data, error } = await supabase.rpc('check_and_unlock_tier', {
    p_user_id: userId,
  });

  if (error) {
    console.error('Error checking tier:', error);
    const tierInfo = await getReferralTierInfo(supabase, userId);
    return {
      tierInfo,
      tierUnlocked: false,
      bonusBananas: 0,
    };
  }

  const result = data?.[0];
  const tierInfo = await getReferralTierInfo(supabase, userId);

  return {
    tierInfo,
    tierUnlocked: result?.tier_unlocked ?? false,
    bonusBananas: result?.bonus_bananas ?? 0,
  };
}

/**
 * Get tier benefits for a specific tier level
 */
export function getTierBenefits(tier: ReferralTierLevel) {
  return TIER_BENEFITS[tier];
}

/**
 * Get user's current referral tier level (quick lookup)
 */
export async function getUserReferralTier(
  supabase: SupabaseClient,
  userId: string
): Promise<ReferralTierLevel> {
  const { data: user } = await supabase
    .from('users')
    .select('referral_tier')
    .eq('id', userId)
    .single();

  return (user?.referral_tier ?? 0) as ReferralTierLevel;
}

/**
 * Get AI generation bonus for user's referral tier
 */
export async function getAIGenerationBonus(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const tier = await getUserReferralTier(supabase, userId);
  return TIER_BENEFITS[tier].aiGenerationsBonus;
}

/**
 * Get AI regeneration bonus for user's referral tier
 */
export async function getAIRegenerationBonus(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const tier = await getUserReferralTier(supabase, userId);
  return TIER_BENEFITS[tier].aiRegenerationsBonus;
}

/**
 * Check if user has priority support (tier 2+)
 */
export async function hasPrioritySupport(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const tier = await getUserReferralTier(supabase, userId);
  return TIER_BENEFITS[tier].hasPrioritySupport;
}

/**
 * Check if user has early access (tier 3)
 */
export async function hasEarlyAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const tier = await getUserReferralTier(supabase, userId);
  return TIER_BENEFITS[tier].hasEarlyAccess;
}

/**
 * Get accessible template count for user
 * Returns -1 for unlimited
 */
export async function getTemplateAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<{ hasAccess: boolean; count: number }> {
  const tier = await getUserReferralTier(supabase, userId);
  const benefits = TIER_BENEFITS[tier];
  return {
    hasAccess: benefits.hasTemplateAccess,
    count: benefits.templateCount,
  };
}

/**
 * Initialize tier record for a new user
 */
export async function initializeTierRecord(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('referral_tiers')
    .upsert({
      user_id: userId,
      current_tier: 0,
      highest_tier_achieved: 0,
      lifetime_conversions: 0,
    }, {
      onConflict: 'user_id',
      ignoreDuplicates: true,
    });

  if (error && !error.message.includes('duplicate')) {
    console.error('Error initializing tier record:', error);
  }
}
