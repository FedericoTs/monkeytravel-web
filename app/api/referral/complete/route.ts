import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { completeReferralIfEligible } from "@/lib/referral/completion";

/**
 * POST /api/referral/complete
 *
 * Thin auth + dispatch shim over the canonical implementation in
 * lib/referral/completion.ts. Previously this route held ~180 lines of
 * business logic that duplicated completeReferralIfEligible almost
 * verbatim — every bug fix had to be applied in two places. The
 * 2026-05-30 lifetime_referral_conversions column-drift bug was a direct
 * consequence of that split (the broken UPDATE existed in both files).
 *
 * Callable when a referred user creates their first trip outside of the
 * standard /api/trips/duplicate and /api/templates/[id]/copy paths
 * (which call completeReferralIfEligible directly). Idempotent — safe
 * to retry.
 *
 * Response keys preserved for backward compatibility with any existing
 * client callers (lib/referral/client.ts maps these into its
 * ReferralCompletionResponse shape).
 */
export async function POST() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const result = await completeReferralIfEligible(supabase, user.id);

    if (!result.success && result.error) {
      return errors.internal(result.error, "Referral Complete");
    }

    // Preserve the legacy response shape — fields are documented in
    // lib/referral/client.ts ReferralCompletionResponse. The shim flattens
    // the structured ReferralCompletionResult so existing callers don't
    // need a follow-up change.
    return apiSuccess({
      success: result.success,
      referrer_rewarded: result.referrerRewarded,
      referee_rewarded: result.refereeRewarded,
      message:
        result.message ??
        (result.alreadyCompleted
          ? "Referral reward already claimed"
          : !result.wasReferred
          ? "User was not referred"
          : undefined),
      bananas: {
        awarded: (result.bananasAwarded ?? 0) > 0,
        tierUnlocked: result.tierUnlocked ?? false,
        newTier: result.tierUnlocked ? result.newTier : undefined,
        tierBonus: result.tierBonus ?? 0,
      },
    });
  } catch (error) {
    console.error("[Referral Complete] Unexpected error:", error);
    return errors.internal("Internal server error", "Referral Complete");
  }
}
