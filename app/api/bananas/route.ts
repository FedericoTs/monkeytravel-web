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

    // Referral stats, both from the code's own counters.
    //
    // "Pending" used to be a count on referral_events filtered by
    // referrer_id and status. Neither column exists (the referrer is reached
    // through referral_code_id, and the status column is reward_status), so
    // the query failed with 42703 on every call and the dashboard always
    // showed 0 pending. Counting events would still be wrong: before
    // 2026-09-23 the conversion-event insert ran on the user's client, which
    // cannot insert there, so conversions are missing from referral_events
    // while total_conversions has them. Signed up but not yet converted is
    // total_signups - total_conversions; attach_referral_on_signup and
    // increment_referral_conversions keep both counters atomically.
    // maybeSingle: an account with no code yet is not an error.
    const { data: referralCode } = await supabase
      .from('referral_codes')
      .select('total_signups, total_conversions')
      .eq('user_id', user.id)
      .maybeSingle();

    const conversions = referralCode?.total_conversions ?? 0;
    const signups = referralCode?.total_signups ?? 0;

    const response: BananasDashboardResponse = {
      balance,
      tier: tierInfo,
      badges,
      recentTransactions,
      referralStats: {
        totalReferrals: conversions,
        pendingReferrals: Math.max(0, signups - conversions),
        bananasEarned,
      },
    };

    return apiSuccess(response);
  } catch (error) {
    console.error('[Bananas] Error in GET /api/bananas:', error);
    return errors.internal('Internal server error', 'Bananas');
  }
}
