import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * Admin endpoint to grant early access to a user
 * This bypasses the normal code redemption flow for admin-granted access
 */
export async function POST(request: Request) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const body = await request.json();
    const { user_email, code } = body;

    if (!user_email) {
      return errors.badRequest("User email is required");
    }

    if (!code) {
      return errors.badRequest("Code is required");
    }

    // Find the target user by email
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, email, full_name")
      .eq("email", user_email.toLowerCase().trim())
      .single();

    if (userError || !targetUser) {
      return errors.notFound(`User not found: ${user_email}`);
    }

    // Check if user already has access
    const { data: existingAccess } = await supabase
      .from("user_tester_access")
      .select("code_used, redeemed_at")
      .eq("user_id", targetUser.id)
      .single();

    if (existingAccess) {
      return errors.badRequest(
        `User already has access via code: ${existingAccess.code_used} (redeemed ${existingAccess.redeemed_at})`
      );
    }

    // Look up the code
    const normalizedCode = code.trim().toUpperCase();
    const { data: testerCode, error: codeError } = await supabase
      .from("tester_codes")
      .select("*")
      .eq("code", normalizedCode)
      .eq("is_active", true)
      .single();

    if (codeError || !testerCode) {
      return errors.badRequest(`Invalid or inactive code: ${normalizedCode}`);
    }

    // Create user access record (admin-granted, bypasses RLS via service role in production)
    // For now, we use an RPC function that has SECURITY DEFINER
    const { data: accessRecord, error: insertError } = await supabase.rpc(
      "admin_grant_early_access",
      {
        p_user_id: targetUser.id,
        p_code_id: testerCode.id,
        p_code_used: normalizedCode,
        p_ai_generations_limit: testerCode.ai_generations_limit,
        p_ai_regenerations_limit: testerCode.ai_regenerations_limit,
        p_ai_assistant_limit: testerCode.ai_assistant_limit,
        p_expires_at: testerCode.expires_at,
        p_granted_by: user.id,
      }
    );

    if (insertError) {
      console.error("[Admin Grant Access] Error:", insertError);

      // Fallback: Try direct insert (might work if admin has elevated privileges)
      const { error: directError } = await supabase
        .from("user_tester_access")
        .insert({
          user_id: targetUser.id,
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

      if (directError) {
        return errors.internal(
          `Failed to grant access. RLS may be blocking. Error: ${directError.message}`,
          "Admin Grant Access"
        );
      }
    }

    // Increment code usage
    await supabase
      .from("tester_codes")
      .update({ current_uses: testerCode.current_uses + 1 })
      .eq("id", testerCode.id);

    return apiSuccess({
      success: true,
      message: `Early access granted to ${targetUser.email}`,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.full_name,
      },
      code: normalizedCode,
      limits: {
        generations: testerCode.ai_generations_limit,
        regenerations: testerCode.ai_regenerations_limit,
        assistant: testerCode.ai_assistant_limit,
      },
      expires_at: testerCode.expires_at,
    });
  } catch (error) {
    console.error("[Admin Grant Access] Unexpected error:", error);
    return errors.internal("Failed to grant access", "Admin Grant Access");
  }
}

/**
 * GET - Check a user's early access status
 */
export async function GET(request: Request) {
  try {
    const { supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return errors.badRequest("Email parameter required");
    }

    // Find the target user
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, email, full_name")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (userError || !targetUser) {
      return errors.notFound(`User not found: ${email}`);
    }

    // Get their access status
    const { data: access } = await supabase
      .from("user_tester_access")
      .select("*")
      .eq("user_id", targetUser.id)
      .single();

    return apiSuccess({
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.full_name,
      },
      hasAccess: !!access,
      access: access || null,
    });
  } catch (error) {
    console.error("[Admin Grant Access] Error checking status:", error);
    return errors.internal("Failed to check access status", "Admin Grant Access");
  }
}
