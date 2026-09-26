/**
 * Tester codes. Redeeming a code gives the user custom AI limits (stored in
 * user_tester_access and applied by lib/usage-limits). There is no access
 * gate: every signed-in user can use every AI feature.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";

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

export interface RedeemCodeResult {
  success: boolean;
  error?: string;
  access?: EarlyAccessStatus;
}

/**
 * Get early access status for a user
 */
async function getEarlyAccessStatus(
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
  // maybeSingle: "no tester row" is the normal case, not an error.
  const { data: access, error } = await supabase
    .from("user_tester_access")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

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

  // Look up the code. Service role (2026-09-23): tester_codes is no longer
  // readable by signed-in users (20260924122000) — every active code was
  // listable with the public anon key, and a code is the only thing standing
  // between a user and its AI limits.
  const admin = createAdminClient();
  const { data: testerCode, error: codeError } = await admin
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

  // Create user access record. Service role (2026-09-23): users can no
  // longer write their own user_tester_access row (20260924122000) — the
  // self INSERT/UPDATE policies let anyone give themselves any AI limit and
  // reset its used counts. The code was validated above; userId comes from
  // the route's session.
  const { error: insertError } = await admin.from("user_tester_access").insert({
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

  // The code's use count is bumped by the definer trigger on
  // user_tester_access (increment_tester_code_usage). The update that stood
  // here ran on the user's client, which tester_codes RLS silently rejected.

  // Return new access status
  const access = await getEarlyAccessStatus(userId);
  return {
    success: true,
    access,
  };
}

