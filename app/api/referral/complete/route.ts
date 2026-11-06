import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { completeReferralIfEligible } from "@/lib/referral/completion";

/**
 * POST /api/referral/complete
 *
 * Thin auth + dispatch shim over the canonical implementation in
 * lib/referral/completion.ts, so a fix lands in one place rather than in two
 * copies of the same logic.
 *
 * Called by the page after a referred user saves a trip outside of the
 * /api/trips/duplicate and /api/templates/[id]/copy paths (which call
 * completeReferralIfEligible directly). Pays nothing for an account with no
 * trip. Idempotent — safe to retry.
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

    // Nothing about the referrer's bananas or tier: this answer goes to the
    // person they referred.
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
    });
  } catch (error) {
    console.error("[Referral Complete] Unexpected error:", error);
    return errors.internal("Internal server error", "Referral Complete");
  }
}
