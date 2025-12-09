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
  accessType: "admin" | "tester" | "none";
  codeUsed?: string;
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
 * Check if a user can perform an AI action
 */
export async function checkEarlyAccess(
  userId: string,
  action: EarlyAccessAction,
  userEmail?: string | null
): Promise<EarlyAccessCheckResult> {
  // Admin bypass
  if (userEmail && isAdmin(userEmail)) {
    return { allowed: true, remaining: null };
  }

  const supabase = await createClient();

  // Get user's access
  const { data: access, error } = await supabase
    .from("user_tester_access")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !access) {
    return {
      allowed: false,
      remaining: 0,
      error: "NO_ACCESS",
      message: "You need an early access code to use AI features.",
    };
  }

  // Check expiration
  if (access.expires_at && new Date(access.expires_at) < new Date()) {
    return {
      allowed: false,
      remaining: 0,
      error: "CODE_EXPIRED",
      message: "Your early access code has expired.",
    };
  }

  // Check limits based on action type
  const limitField = `ai_${action}s_limit` as keyof typeof access;
  const usedField = `ai_${action}s_used` as keyof typeof access;

  const limit = access[limitField] as number | null;
  const used = access[usedField] as number;

  // Unlimited if limit is null
  if (limit === null) {
    return { allowed: true, remaining: null };
  }

  // Check if limit reached
  if (used >= limit) {
    return {
      allowed: false,
      remaining: 0,
      error: "LIMIT_REACHED",
      message: `You've reached your ${action} limit (${limit}).`,
    };
  }

  return {
    allowed: true,
    remaining: limit - used,
  };
}

/**
 * Increment usage after a successful AI action
 */
export async function incrementEarlyAccessUsage(
  userId: string,
  action: EarlyAccessAction
): Promise<boolean> {
  const supabase = await createClient();
  const usedField = `ai_${action}s_used`;

  // Use RPC or direct increment
  const { error } = await supabase.rpc("increment_early_access_usage", {
    p_user_id: userId,
    p_field: usedField,
  });

  if (error) {
    // Fallback: direct update
    const { data: access } = await supabase
      .from("user_tester_access")
      .select(usedField)
      .eq("user_id", userId)
      .single();

    if (access && typeof access === "object") {
      const accessObj = access as unknown as Record<string, number>;
      const currentValue = accessObj[usedField] || 0;
      await supabase
        .from("user_tester_access")
        .update({ [usedField]: currentValue + 1 })
        .eq("user_id", userId);
    }
  }

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
