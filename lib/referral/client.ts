"use client";

/**
 * Referral Completion - Client-side API
 *
 * Provides a simple async function to trigger referral completion
 * from client-side trip creation flows.
 */

import {
  captureReferralConverted,
  captureTripCreated,
} from "@/lib/posthog/events";
import { safeGet } from "@/lib/safe-storage";

export interface ReferralCompletionResponse {
  success: boolean;
  wasReferred?: boolean;
  referrer_rewarded?: boolean;
  referee_rewarded?: boolean;
  message?: string;
  bananas?: {
    awarded: boolean;
    tierUnlocked: boolean;
    newTier?: number;
    tierBonus: number;
  };
  error?: string;
}

/**
 * Complete referral rewards after first trip creation
 *
 * This calls the /api/referral/complete endpoint.
 * Safe to call multiple times - the API is idempotent.
 *
 * @returns Result of the referral completion attempt
 */
export async function completeReferral(): Promise<ReferralCompletionResponse> {
  try {
    const response = await fetch("/api/referral/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[Referral] API error:", data.error);
      return {
        success: false,
        error: data.error || "Failed to complete referral",
      };
    }

    return data as ReferralCompletionResponse;
  } catch (error) {
    console.error("[Referral] Network error:", error);
    return {
      success: false,
      error: "Network error during referral completion",
    };
  }
}

/**
 * Complete referral and track in PostHog (combined operation)
 *
 * Use this after saving a trip to handle all referral + tracking logic.
 *
 * @param tripId - The ID of the created trip
 * @param destination - The trip destination
 * @param durationDays - Number of days
 * @param budgetTier - Budget tier selected
 * @param isFromTemplate - Whether created from a template
 */
export async function handleTripCreatedWithReferral(
  tripId: string,
  destination: string,
  durationDays: number,
  budgetTier: "budget" | "balanced" | "premium",
  isFromTemplate: boolean = false
): Promise<{
  tripTracked: boolean;
  referralCompleted: boolean;
  bananasAwarded: boolean;
}> {
  const result = {
    tripTracked: false,
    referralCompleted: false,
    bananasAwarded: false,
  };

  // 1. Track trip creation in PostHog
  try {
    captureTripCreated({
      trip_id: tripId,
      destination,
      duration_days: durationDays,
      budget_tier: budgetTier,
      is_from_template: isFromTemplate,
    });
    result.tripTracked = true;
  } catch (error) {
    console.error("[Referral] Error tracking trip:", error);
  }

  // 2. Complete referral (if eligible)
  try {
    const referralResult = await completeReferral();

    if (referralResult.success) {
      result.referralCompleted = true;

      // Track additional events if referral was processed.
      // Note: first_trip_saved is no longer fired here — it's fired
      // unconditionally from the trip-save success handler in
      // NewTripWizard so organic (non-referred) users get the event too
      // (Task #319, 2026-05-31). Referral-specific telemetry stays at
      // lib/referral/completion.ts (referral_converted, server-side).
      if (referralResult.wasReferred && referralResult.referee_rewarded) {
        // Track bananas if awarded
        if (referralResult.bananas?.awarded) {
          result.bananasAwarded = true;
        }
      }
    }
  } catch (error) {
    console.error("[Referral] Error completing referral:", error);
  }

  return result;
}

/**
 * Check if the current user might be eligible for referral rewards
 *
 * This is a quick client-side check using localStorage.
 * The actual eligibility is verified server-side.
 */
export function mightBeEligibleForReferralReward(): boolean {
  // `typeof window === "undefined"` is an SSR check, not a storage check. It
  // passes in a real Safari with "block all cookies", where the localStorage
  // identifier is unresolvable and the access below throws — the same
  // ReferenceError that took the login page down (JAVASCRIPT-NEXTJS-28).
  // safeGet answers null instead, which for a "might be eligible" hint is the
  // right degradation: the server verifies eligibility anyway.
  return !!safeGet("referral_code");
}
