import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import { getAuthenticatedUser } from '@/lib/api/auth';
import {
  getBananaBalance,
  getTransactionHistory,
  getReferralTierInfo,
  getTierBadges,
  getReferralBananasEarned,
} from '@/lib/bananas';
import type { BananasDashboardResponse } from '@/types/bananas';

/**
 * GET /api/bananas - Get user's banana balance, tier info, and recent transactions
 */
export async function GET() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Fetch all data in parallel
    const [balance, tierInfo, badges, recentTransactions, bananasEarned] = await Promise.all([
      getBananaBalance(supabase, user.id),
      getReferralTierInfo(supabase, user.id),
      getTierBadges(supabase, user.id),
      getTransactionHistory(supabase, user.id, 10),
      getReferralBananasEarned(supabase, user.id),
    ]);

    // Get referral stats
    const { data: referralCode } = await supabase
      .from('referral_codes')
      .select('total_conversions')
      .eq('user_id', user.id)
      .single();

    const { count: pendingCount } = await supabase
      .from('referral_events')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', user.id)
      .eq('status', 'pending');

    const response: BananasDashboardResponse = {
      balance,
      tier: tierInfo,
      badges,
      recentTransactions,
      referralStats: {
        totalReferrals: referralCode?.total_conversions ?? 0,
        pendingReferrals: pendingCount ?? 0,
        bananasEarned,
      },
    };

    return apiSuccess(response);
  } catch (error) {
    console.error('[Bananas] Error in GET /api/bananas:', error);
    return errors.internal('Internal server error', 'Bananas');
  }
}
