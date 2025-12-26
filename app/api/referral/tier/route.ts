import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import { getAuthenticatedUser } from '@/lib/api/auth';
import {
  getReferralTierInfo,
  getTierBadges,
  getTierBenefits,
  getTierProgress,
  TIER_NAMES,
  TIER_EMOJIS,
  TIER_DESCRIPTIONS,
} from '@/lib/bananas';
import type { ReferralTierLevel } from '@/types/bananas';

/**
 * GET /api/referral/tier - Get user's referral tier status and benefits
 */
export async function GET() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const [tierInfo, badges] = await Promise.all([
      getReferralTierInfo(supabase, user.id),
      getTierBadges(supabase, user.id),
    ]);

    const currentBenefits = getTierBenefits(tierInfo.currentTier);
    const progress = getTierProgress(tierInfo.lifetimeConversions);

    // Get next tier benefits for comparison (if not at max)
    const nextTier = tierInfo.currentTier < 3
      ? (tierInfo.currentTier + 1) as ReferralTierLevel
      : null;
    const nextTierBenefits = nextTier ? getTierBenefits(nextTier) : null;

    return apiSuccess({
      tier: {
        level: tierInfo.currentTier,
        name: TIER_NAMES[tierInfo.currentTier],
        emoji: TIER_EMOJIS[tierInfo.currentTier],
        description: TIER_DESCRIPTIONS[tierInfo.currentTier],
      },
      progress: {
        current: tierInfo.lifetimeConversions,
        nextTierAt: tierInfo.nextTierAt,
        remaining: tierInfo.conversionsToNextTier,
        percentage: progress,
      },
      benefits: {
        current: currentBenefits,
        next: nextTierBenefits,
      },
      badges,
      highestTierAchieved: tierInfo.highestTierAchieved,
    });
  } catch (error) {
    console.error('[Referral Tier] Unexpected error:', error);
    return errors.internal("Internal server error", "Referral Tier");
  }
}
