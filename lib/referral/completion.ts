/**
 * Referral Completion - Server-side Logic
 *
 * This module handles completing referral rewards when a referred user
 * creates their first trip. It's called from:
 * - Trip creation wizard (via API call)
 * - Template copy API
 * - Trip duplicate API
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { captureServerEvent } from "@/lib/posthog/server";
import {
  addReferralBananas,
  checkAndUnlockTier,
  getUserReferralTier,
  getTierForConversions,
} from "@/lib/bananas";

export interface ReferralCompletionResult {
  success: boolean;
  wasReferred: boolean;
  alreadyCompleted: boolean;
  referrerRewarded: boolean;
  refereeRewarded: boolean;
  bananasAwarded?: number;
  tierUnlocked?: boolean;
  newTier?: number;
  tierBonus?: number;
  message?: string;
  error?: string;
}

/**
 * Check and complete referral for a user
 *
 * This should be called when a user creates their first trip.
 * It's idempotent - safe to call multiple times.
 *
 * @param supabase - Supabase client with user context
 * @param userId - The ID of the user who just created a trip
 * @param tripId - The ID of the created trip (for tracking)
 * @returns Result object with reward status
 */
export async function completeReferralIfEligible(
  supabase: SupabaseClient,
  userId: string,
  tripId?: string
): Promise<ReferralCompletionResult> {
  try {
    // Get user's referral info
    const { data: currentUser, error: userError } = await supabase
      .from("users")
      .select("referred_by_code, referral_completed_at, free_trips_remaining")
      .eq("id", userId)
      .single();

    if (userError || !currentUser) {
      return {
        success: false,
        wasReferred: false,
        alreadyCompleted: false,
        referrerRewarded: false,
        refereeRewarded: false,
        error: "User not found",
      };
    }

    // Check if user was referred
    if (!currentUser.referred_by_code) {
      return {
        success: true,
        wasReferred: false,
        alreadyCompleted: false,
        referrerRewarded: false,
        refereeRewarded: false,
        message: "User was not referred",
      };
    }

    // Check if already completed
    if (currentUser.referral_completed_at) {
      return {
        success: true,
        wasReferred: true,
        alreadyCompleted: true,
        referrerRewarded: false,
        refereeRewarded: false,
        message: "Referral reward already claimed",
      };
    }

    // Find the referrer's code
    const { data: referralCode, error: codeError } = await supabase
      .from("referral_codes")
      .select("id, user_id, total_conversions")
      .eq("code", currentUser.referred_by_code)
      .single();

    if (codeError || !referralCode) {
      return {
        success: false,
        wasReferred: true,
        alreadyCompleted: false,
        referrerRewarded: false,
        refereeRewarded: false,
        error: "Referral code not found",
      };
    }

    // Get referrer's current free trips
    const { data: referrer } = await supabase
      .from("users")
      .select("free_trips_remaining")
      .eq("id", referralCode.user_id)
      .single();

    const now = new Date().toISOString();

    // 1. Grant reward to referee (current user)
    const { error: refereeError } = await supabase
      .from("users")
      .update({
        free_trips_remaining: (currentUser.free_trips_remaining || 0) + 1,
        referral_completed_at: now,
      })
      .eq("id", userId);

    if (refereeError) {
      console.error("[Referral Complete] Error updating referee:", refereeError);
      return {
        success: false,
        wasReferred: true,
        alreadyCompleted: false,
        referrerRewarded: false,
        refereeRewarded: false,
        error: "Failed to grant reward to referee",
      };
    }

    // 2. Grant reward to referrer
    let referrerRewarded = false;
    const { error: referrerError } = await supabase
      .from("users")
      .update({
        free_trips_remaining: (referrer?.free_trips_remaining || 0) + 1,
      })
      .eq("id", referralCode.user_id);

    if (!referrerError) {
      referrerRewarded = true;
    } else {
      console.error("[Referral Complete] Error updating referrer:", referrerError);
    }

    // 3. Record conversion event
    const { data: eventData, error: eventError } = await supabase
      .from("referral_events")
      .insert({
        referral_code_id: referralCode.id,
        referee_id: userId,
        event_type: "conversion",
        reward_granted_at: now,
        reward_amount: 1,
      })
      .select("id")
      .single();

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

    // 5. Award bananas to referrer
    let bananasAwarded = 0;
    let tierUnlocked = false;
    let newTier = 0;
    let tierBonusBananas = 0;

    try {
      // Get referrer's current tier for bonus calculation
      const referrerTier = await getUserReferralTier(supabase, referralCode.user_id);

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

      // Calculate tier directly from conversions as fallback
      const calculatedTier = getTierForConversions(newConversionCount);
      const effectiveTier = Math.max(newTier, calculatedTier);

      // 6. Sync users table with updated conversion count and tier
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

      newTier = effectiveTier;
    } catch (bananaError) {
      console.error("[Referral Complete] Error awarding bananas:", bananaError);
      // Don't fail the request - free trips already granted
    }

    // 7. Track in PostHog (server-side)
    try {
      // Track referral conversion for the referrer
      await captureServerEvent(referralCode.user_id, "referral_converted", {
        referral_code: currentUser.referred_by_code,
        referee_id: userId,
        trip_id: tripId,
        bananas_awarded: bananasAwarded,
        tier_unlocked: tierUnlocked,
        new_tier: newTier,
        tier_bonus: tierBonusBananas,
      });

      // Track first trip saved for the referee
      await captureServerEvent(userId, "first_trip_saved", {
        trip_id: tripId,
        was_referred: true,
        referral_code: currentUser.referred_by_code,
        referrer_id: referralCode.user_id,
      });
    } catch (trackError) {
      console.error("[Referral Complete] Error tracking event:", trackError);
      // Don't fail for tracking errors
    }

    return {
      success: true,
      wasReferred: true,
      alreadyCompleted: false,
      referrerRewarded,
      refereeRewarded: true,
      bananasAwarded,
      tierUnlocked,
      newTier: tierUnlocked ? newTier : undefined,
      tierBonus: tierBonusBananas,
      message: "Congratulations! You and your friend each earned 1 free trip!",
    };
  } catch (error) {
    console.error("[Referral Complete] Unexpected error:", error);
    return {
      success: false,
      wasReferred: false,
      alreadyCompleted: false,
      referrerRewarded: false,
      refereeRewarded: false,
      error: "Unexpected error during referral completion",
    };
  }
}

/**
 * Check if a user is eligible for first-trip rewards
 *
 * Returns true if:
 * - User was referred (has referred_by_code)
 * - Referral not yet completed (referral_completed_at is null)
 */
export async function isEligibleForFirstTripReward(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("referred_by_code, referral_completed_at")
      .eq("id", userId)
      .single();

    if (error || !data) return false;

    return !!(data.referred_by_code && !data.referral_completed_at);
  } catch {
    return false;
  }
}
