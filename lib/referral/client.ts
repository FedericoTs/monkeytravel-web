"use client";

/**
 * Referral Completion - Client-side API
 *
 * Provides a simple async function to trigger referral completion
 * from client-side trip creation flows.
 */

import {
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
      // first_trip_saved is fired from the trip-save success handlers in
      // NewTripWizard, so organic (non-referred) users get the event too.
      // Referral-specific telemetry lives in lib/referral/completion.ts
      // (referral_converted, server-side).
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
 * Put the referral code this browser is holding (from a friend's shared trip,
 * /join/<code> or a ?ref link: all store "referral_code") on an auth callback
 * URL, so a new account made through it is credited to that friend. The
 * callback only attaches on the account's first arrival, so a returning user
 * signing in through the same URL is never made "referred".
 */
export function withStoredReferral(callbackUrl: string): string {
  const code = safeGet("referral_code");
  if (!code) return callbackUrl;
  try {
    const url = new URL(callbackUrl);
    url.searchParams.set("ref", code);
    return url.toString();
  } catch {
    return callbackUrl;
  }
}

/**
 * Credit a friend for an account created in this browser without passing
 * through /auth/callback (a sign-in code typed in the tab). keepalive: the
 * caller navigates away right after. The server attaches only for new
 * accounts, once.
 */
export function attachStoredReferral(): void {
  const code = safeGet("referral_code");
  if (!code) return;
  void fetch("/api/referral/attach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    keepalive: true,
  }).catch(() => {
    /* best-effort: never blocks signing in */
  });
}
