/**
 * Early Access Gate System
 *
 * Controls access to AI features during the early access period.
 * Users need to redeem a tester code to use AI features.
 */

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

export type EarlyAccessAction = "generation" | "regeneration" | "assistant";

export interface EarlyAccessStatus {
  hasAccess: boolean;
  isAdmin: boolean;
  accessType: "admin" | "tester" | "free_trip" | "none";
  codeUsed?: string;
  freeTripsRemaining?: number;
  limits?: {
    generations: { limit: number | null; used: number };
    regenerations: { limit: number | null; used: number };
    assistant: { limit: number | null; used: number };
  };
  expiresAt?: string | null;
  redeemedAt?: string;
}

export interface EarlyAccessCheckResult {
  allowed: boolean;
  remaining: number | null; // null = unlimited
  error?: "NO_ACCESS" | "CODE_EXPIRED" | "LIMIT_REACHED";
  message?: string;
  accessType?: "admin" | "tester" | "free_trip"; // How access was granted
  freeTripsRemaining?: number; // For free trip users
}

export interface RedeemCodeResult {
  success: boolean;
  error?: string;
  access?: EarlyAccessStatus;
}

/**
 * Get early access status for a user
 */
export async function getEarlyAccessStatus(
  userId: string,
  userEmail?: string | null
): Promise<EarlyAccessStatus> {
  // Admin bypass - always has access
  if (userEmail && isAdmin(userEmail)) {
    return {
      hasAccess: true,
      isAdmin: true,
      accessType: "admin",
    };
  }

  const supabase = await createClient();

  // Check if user has redeemed a code
  const { data: access, error } = await supabase
    .from("user_tester_access")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !access) {
    return {
      hasAccess: false,
      isAdmin: false,
      accessType: "none",
    };
  }

  // Check expiration
  if (access.expires_at && new Date(access.expires_at) < new Date()) {
    return {
      hasAccess: false,
      isAdmin: false,
      accessType: "none",
      codeUsed: access.code_used,
      expiresAt: access.expires_at,
    };
  }

  return {
    hasAccess: true,
    isAdmin: false,
    accessType: "tester",
    codeUsed: access.code_used,
    limits: {
      generations: {
        limit: access.ai_generations_limit,
        used: access.ai_generations_used,
      },
      regenerations: {
        limit: access.ai_regenerations_limit,
        used: access.ai_regenerations_used,
      },
      assistant: {
        limit: access.ai_assistant_limit,
        used: access.ai_assistant_used,
      },
    },
    expiresAt: access.expires_at,
    redeemedAt: access.redeemed_at,
  };
}

/**
 * Check if a user can perform an AI action.
 *
 * **2026-05-23 PRODUCT DECISION**: The closed-beta gate has been removed —
 * the app is fully free with no paywall. Every authenticated user can use
 * every AI feature without limit. This function now returns `allowed: true`
 * unconditionally; the original gate logic is kept commented below in case
 * we ever need to reintroduce a beta or paywall flow.
 *
 * Anonymous-user limits (e.g. "1 free generation, then sign up to save") are
 * handled separately in `lib/anonymous/rate-limit.ts` — not in this file,
 * which only sees authenticated users.
 */
export async function checkEarlyAccess(
  _userId: string,
  _action: EarlyAccessAction,
  userEmail?: string | null
): Promise<EarlyAccessCheckResult> {
  // Admin remains admin (mostly cosmetic — every user is now effectively
  // unlimited anyway, but keeping the accessType for analytics/debug).
  if (userEmail && isAdmin(userEmail)) {
    return { allowed: true, remaining: null, accessType: "admin" };
  }

  // Everyone else is also unlimited. accessType="free_trip" preserves the
  // legacy enum; downstream callers don't make decisions based on the value.
  return {
    allowed: true,
    remaining: null,
    accessType: "free_trip",
  };
}

/**
 * Increment usage after a successful AI action.
 *
 * No-op since the beta gate was removed 2026-05-23 — we no longer cap usage,
 * so there's nothing to count. Kept as a function (rather than deleted) to
 * preserve the call sites in /api/ai/* routes without churn. If a paywall
 * ever lands, restore the original increment logic from git history.
 */
export async function incrementEarlyAccessUsage(
  _userId: string,
  _action: EarlyAccessAction
): Promise<boolean> {
  return true;
}

/**
 * Redeem a tester code for a user
 */
export async function redeemTesterCode(
  userId: string,
  code: string
): Promise<RedeemCodeResult> {
  const supabase = await createClient();
  const normalizedCode = code.trim().toUpperCase();

  // Check if user already has access
  const { data: existingAccess } = await supabase
    .from("user_tester_access")
    .select("code_used")
    .eq("user_id", userId)
    .single();

  if (existingAccess) {
    return {
      success: false,
      error: `You've already redeemed a code: ${existingAccess.code_used}`,
    };
  }

  // Look up the code
  const { data: testerCode, error: codeError } = await supabase
    .from("tester_codes")
    .select("*")
    .eq("code", normalizedCode)
    .eq("is_active", true)
    .single();

  if (codeError || !testerCode) {
    return {
      success: false,
      error: "Invalid code. Please check and try again.",
    };
  }

  // Check expiration
  if (testerCode.expires_at && new Date(testerCode.expires_at) < new Date()) {
    return {
      success: false,
      error: "This code has expired.",
    };
  }

  // Check max uses
  if (
    testerCode.max_uses !== null &&
    testerCode.current_uses >= testerCode.max_uses
  ) {
    return {
      success: false,
      error: "This code has reached its maximum number of uses.",
    };
  }

  // Create user access record
  const { error: insertError } = await supabase.from("user_tester_access").insert({
    user_id: userId,
    code_id: testerCode.id,
    code_used: normalizedCode,
    ai_generations_limit: testerCode.ai_generations_limit,
    ai_generations_used: 0,
    ai_regenerations_limit: testerCode.ai_regenerations_limit,
    ai_regenerations_used: 0,
    ai_assistant_limit: testerCode.ai_assistant_limit,
    ai_assistant_used: 0,
    expires_at: testerCode.expires_at,
  });

  if (insertError) {
    console.error("[EarlyAccess] Error creating access:", insertError);
    return {
      success: false,
      error: "Failed to redeem code. Please try again.",
    };
  }

  // Increment code usage
  await supabase
    .from("tester_codes")
    .update({ current_uses: testerCode.current_uses + 1 })
    .eq("id", testerCode.id);

  // Return new access status
  const access = await getEarlyAccessStatus(userId);
  return {
    success: true,
    access,
  };
}

/**
 * Validate a code without redeeming it
 */
export async function validateCode(
  code: string
): Promise<{ valid: boolean; error?: string }> {
  const supabase = await createClient();
  const normalizedCode = code.trim().toUpperCase();

  const { data: testerCode, error } = await supabase
    .from("tester_codes")
    .select("expires_at, max_uses, current_uses, is_active")
    .eq("code", normalizedCode)
    .single();

  if (error || !testerCode) {
    return { valid: false, error: "Invalid code" };
  }

  if (!testerCode.is_active) {
    return { valid: false, error: "Code is no longer active" };
  }

  if (testerCode.expires_at && new Date(testerCode.expires_at) < new Date()) {
    return { valid: false, error: "Code has expired" };
  }

  if (
    testerCode.max_uses !== null &&
    testerCode.current_uses >= testerCode.max_uses
  ) {
    return { valid: false, error: "Code has reached max uses" };
  }

  return { valid: true };
}

/**
 * Decrement free_trips_remaining for a user after using their free trip.
 *
 * No-op since the beta gate was removed 2026-05-23. Free-trip accounting is
 * no longer enforced. Returns a large sentinel so any caller using the return
 * value as "remaining" displays as effectively unlimited.
 */
export async function decrementFreeTrips(_userId: string): Promise<number> {
  return 999;
}
