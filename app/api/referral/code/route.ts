import {
  getBananaBalance,
  getReferralTierInfo,
  getReferralBananasEarned,
  TIER_NAMES,
  TIER_EMOJIS,
} from "@/lib/bananas";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";

/**
 * GET /api/referral/code
 * Returns the current user's referral code with banana stats (creates code if doesn't exist)
 */
export async function GET() {
  try {
    // Use shared auth helper
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Check if user already has a referral code
    const { data: existingCode } = await supabase
      .from("referral_codes")
      .select("code, total_clicks, total_signups, total_conversions")
      .eq("user_id", user.id)
      .single();

    if (existingCode) {
      // Fetch banana stats in parallel
      const [balance, tierInfo, bananasEarned] = await Promise.all([
        getBananaBalance(supabase, user.id),
        getReferralTierInfo(supabase, user.id),
        getReferralBananasEarned(supabase, user.id),
      ]);

      return apiSuccess({
        code: existingCode.code,
        stats: {
          clicks: existingCode.total_clicks,
          signups: existingCode.total_signups,
          conversions: existingCode.total_conversions,
        },
        bananas: {
          balance: balance.available,
          expiringSoon: balance.expiringSoon,
          lifetimeEarned: bananasEarned,
        },
        tier: {
          level: tierInfo.currentTier,
          name: TIER_NAMES[tierInfo.currentTier],
          emoji: TIER_EMOJIS[tierInfo.currentTier],
          progress: {
            current: tierInfo.lifetimeConversions,
            nextAt: tierInfo.nextTierAt,
            remaining: tierInfo.conversionsToNextTier,
          },
        },
      });
    }

    // Generate new referral code using the database function
    const { data: newCode, error: createError } = await supabase
      .rpc("get_or_create_referral_code", { p_user_id: user.id });

    if (createError) {
      console.error("[Referral] Error creating code:", createError);
      return errors.internal("Failed to create referral code", "Referral");
    }

    return apiSuccess({
      code: newCode,
      stats: {
        clicks: 0,
        signups: 0,
        conversions: 0,
      },
      bananas: {
        balance: 0,
        expiringSoon: 0,
        lifetimeEarned: 0,
      },
      tier: {
        level: 0,
        name: TIER_NAMES[0],
        emoji: TIER_EMOJIS[0],
        progress: {
          current: 0,
          nextAt: 3,
          remaining: 3,
        },
      },
    });
  } catch (error) {
    console.error("[Referral] Unexpected error:", error);
    return errors.internal("Internal server error", "Referral");
  }
}
