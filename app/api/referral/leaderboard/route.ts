import { NextRequest } from 'next/server';
import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { LEADERBOARD_SIZE, TIER_NAMES, TIER_EMOJIS, getTierForConversions } from '@/lib/bananas';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardPeriod,
  LeaderboardVisibility,
  TierBadgeInfo,
  ReferralTierLevel,
} from '@/types/bananas';

/**
 * Anonymize display name based on visibility preference
 */
function anonymizeDisplayName(
  displayName: string,
  visibility: LeaderboardVisibility
): string {
  if (visibility === 'full') {
    return displayName;
  }
  if (visibility === 'initials') {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase() + '.';
    }
    return parts
      .map((part, i) =>
        i === 0 ? part : part.charAt(0).toUpperCase() + '.'
      )
      .join(' ');
  }
  // anonymous
  return 'Anonymous Traveler';
}

/**
 * GET /api/referral/leaderboard - Get referral leaderboard
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') || 'alltime') as LeaderboardPeriod;

    // Get users who opt-in to leaderboard with their referral stats
    const { data: leaderboardData, error: leaderboardError } = await supabase
      .from('users')
      .select(`
        id,
        display_name,
        avatar_url,
        leaderboard_visibility,
        show_on_leaderboard,
        referral_tier,
        referral_codes (
          total_conversions
        ),
        referral_tiers (
          highest_tier_achieved,
          tier_1_unlocked_at,
          tier_2_unlocked_at,
          tier_3_unlocked_at
        )
      `)
      .eq('show_on_leaderboard', true)
      .order('referral_tier', { ascending: false });

    if (leaderboardError) {
      console.error('[Referral Leaderboard] Error fetching leaderboard:', leaderboardError);
      return errors.internal("Failed to fetch leaderboard", "Referral Leaderboard");
    }

    // Process and sort entries
    const processedEntries = (leaderboardData || [])
      .map(userData => {
        const referralCode = userData.referral_codes?.[0] || userData.referral_codes;
        const referralTier = userData.referral_tiers?.[0] || userData.referral_tiers;
        const conversions = referralCode?.total_conversions ?? 0;

        return {
          userId: userData.id,
          displayName: userData.display_name || 'Traveler',
          avatarUrl: userData.avatar_url,
          visibility: (userData.leaderboard_visibility || 'initials') as LeaderboardVisibility,
          conversions,
          tier: (userData.referral_tier || 0) as ReferralTierLevel,
          highestTier: (referralTier?.highest_tier_achieved || userData.referral_tier || 0) as ReferralTierLevel,
          tierUnlockedAt: referralTier?.tier_1_unlocked_at || null,
        };
      })
      .filter(entry => entry.conversions > 0) // Only show users with conversions
      .sort((a, b) => b.conversions - a.conversions);

    // Get total count before slicing
    const totalParticipants = processedEntries.length;

    // Find current user's rank
    const userIndex = processedEntries.findIndex(e => e.userId === user.id);
    const userRank = userIndex >= 0 ? userIndex + 1 : null;

    // Take top N for leaderboard
    const topEntries = processedEntries.slice(0, LEADERBOARD_SIZE);

    // Map to response format with anonymization
    const entries: LeaderboardEntry[] = topEntries.map((entry, index) => {
      const isCurrentUser = entry.userId === user.id;

      // Create badge info if user has a tier
      let badge: TierBadgeInfo | null = null;
      if (entry.highestTier > 0) {
        badge = {
          tier: entry.highestTier,
          name: TIER_NAMES[entry.highestTier],
          emoji: TIER_EMOJIS[entry.highestTier],
          unlocked: true,
          unlockedAt: entry.tierUnlockedAt || undefined,
        };
      }

      return {
        rank: index + 1,
        displayName: isCurrentUser
          ? entry.displayName  // Show own full name
          : anonymizeDisplayName(entry.displayName, entry.visibility),
        avatarUrl: entry.visibility === 'anonymous' ? undefined : entry.avatarUrl,
        badge,
        referralCount: entry.conversions,
        isCurrentUser,
      };
    });

    const response: LeaderboardResponse = {
      period,
      entries,
      userRank,
      totalParticipants,
      updatedAt: new Date().toISOString(),
    };

    return apiSuccess(response);
  } catch (error) {
    console.error('[Referral Leaderboard] Unexpected error:', error);
    return errors.internal("Internal server error", "Referral Leaderboard");
  }
}
