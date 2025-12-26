import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import {
  addReferralBananas,
  checkAndUnlockTier,
  getUserReferralTier,
  getTierForConversions,
} from "@/lib/bananas";

/**
 * POST /api/referral/complete
 * Called when a referred user creates their first trip
 * Grants rewards to both referrer and referee (free trips + bananas)
 */
export async function POST() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get user's referral info
    const { data: currentUser } = await supabase
      .from("users")
      .select("referred_by_code, referral_completed_at, free_trips_remaining")
      .eq("id", user.id)
      .single();

    // Check if user was referred and hasn't completed yet
    if (!currentUser?.referred_by_code) {
      return apiSuccess({
        success: false,
        message: "User was not referred",
      });
    }

    if (currentUser.referral_completed_at) {
      return apiSuccess({
        success: false,
        message: "Referral reward already claimed",
      });
    }

    // Find the referrer's code
    const { data: referralCode } = await supabase
      .from("referral_codes")
      .select("id, user_id, total_conversions")
      .eq("code", currentUser.referred_by_code)
      .single();

    if (!referralCode) {
      return apiSuccess({
        success: false,
        message: "Referral code not found",
      });
    }

    // Get referrer's current free trips
    const { data: referrer } = await supabase
      .from("users")
      .select("free_trips_remaining")
      .eq("id", referralCode.user_id)
      .single();

    // Start transaction-like operations
    const now = new Date().toISOString();

    // 1. Grant reward to referee (current user)
    const { error: refereeError } = await supabase
      .from("users")
      .update({
        free_trips_remaining: (currentUser.free_trips_remaining || 0) + 1,
        referral_completed_at: now,
      })
      .eq("id", user.id);

    if (refereeError) {
      console.error("[Referral Complete] Error updating referee:", refereeError);
      return errors.internal("Failed to grant reward to referee", "Referral Complete");
    }

    // 2. Grant reward to referrer
    const { error: referrerError } = await supabase
      .from("users")
      .update({
        free_trips_remaining: (referrer?.free_trips_remaining || 0) + 1,
      })
      .eq("id", referralCode.user_id);

    if (referrerError) {
      console.error("[Referral Complete] Error updating referrer:", referrerError);
      // Don't fail - referee already got their reward
    }

    // 3. Record conversion event
    const { error: eventError } = await supabase
      .from("referral_events")
      .insert({
        referral_code_id: referralCode.id,
        referee_id: user.id,
        event_type: "conversion",
        reward_granted_at: now,
        reward_amount: 1,
      });

    if (eventError) {
      console.error("[Referral Complete] Error recording event:", eventError);
    }

    // 4. Update conversion count in referral_codes
    const newConversionCount = (referralCode.total_conversions || 0) + 1;
    await supabase
      .from("referral_codes")
      .update({
        total_conversions: newConversionCount,
      })
      .eq("id", referralCode.id);

    // 5. Award bananas to referrer (new banana system)
    let bananasAwarded = 0;
    let tierUnlocked = false;
    let newTier = 0;
    let tierBonusBananas = 0;

    try {
      // Get referrer's current tier for bonus calculation
      const referrerTier = await getUserReferralTier(supabase, referralCode.user_id);

      // Get the referral event ID for reference
      const { data: eventData } = await supabase
        .from("referral_events")
        .select("id")
        .eq("referral_code_id", referralCode.id)
        .eq("referee_id", user.id)
        .eq("event_type", "conversion")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Award bananas to referrer
      const bananaResult = await addReferralBananas(
        supabase,
        referralCode.user_id,
        eventData?.id,
        referrerTier
      );

      if (bananaResult.success) {
        bananasAwarded = bananaResult.newBalance;
      }

      // Check and unlock tier if eligible
      const tierResult = await checkAndUnlockTier(supabase, referralCode.user_id);
      tierUnlocked = tierResult.tierUnlocked;
      newTier = tierResult.tierInfo.currentTier;
      tierBonusBananas = tierResult.bonusBananas;

      // Calculate tier directly from conversions as fallback/verification
      const calculatedTier = getTierForConversions(newConversionCount);
      // Use the higher of calculated or RPC-returned tier (safety check)
      const effectiveTier = Math.max(newTier, calculatedTier);

      // 6. CRITICAL: Sync users table with updated conversion count and tier
      // This ensures the usage limits check works correctly
      const { error: syncError } = await supabase
        .from("users")
        .update({
          lifetime_referral_conversions: newConversionCount,
          referral_tier: effectiveTier,
        })
        .eq("id", referralCode.user_id);

      if (syncError) {
        console.error("[Referral Complete] Error syncing user stats:", syncError);
      }

      // Update newTier for response
      newTier = effectiveTier;
    } catch (bananaError) {
      console.error("[Referral Complete] Error awarding bananas:", bananaError);
      // Don't fail the request - free trips already granted
    }

    return apiSuccess({
      success: true,
      referrer_rewarded: !referrerError,
      referee_rewarded: true,
      message: "Congratulations! You and your friend each earned 1 free trip!",
      bananas: {
        awarded: bananasAwarded > 0,
        tierUnlocked,
        newTier: tierUnlocked ? newTier : undefined,
        tierBonus: tierBonusBananas,
      },
    });
  } catch (error) {
    console.error("[Referral Complete] Unexpected error:", error);
    return errors.internal("Internal server error", "Referral Complete");
  }
}
