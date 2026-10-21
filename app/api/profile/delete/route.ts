import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiError, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { isSameOrigin } from "@/lib/api/same-origin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { verifyDeletionCode } from "@/lib/auth/deletion-code";
import { createClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

/**
 * POST /api/profile/delete
 *
 * Permanently deletes the authenticated user's account and all associated data.
 *
 * Security:
 * - Step-up auth: the caller proves it is them again, with the six-digit code
 *   from /api/profile/delete/code or with their password. Defeats same-origin
 *   XSS / malicious extensions that can ride an existing session cookie. The
 *   code is what Google sign-ins use: they have no password.
 * - Same-origin check via Sec-Fetch-Site (or Origin fallback).
 * - Attempts are rate limited per user.
 * - Method changed from DELETE -> POST so it carries a body and lands in
 *   the normal CSRF-protected fetch surface.
 *
 * Transactional cascade:
 * - public.delete_user_account(p_user_id) RPC wraps trips/ai_usage/
 *   user_tester_access/users deletes in a single implicit transaction.
 *   Most child rows are removed via FK CASCADE.
 * - auth.users.deleteUser is a separate auth-schema call and runs AFTER
 *   the RPC succeeds.
 */

interface DeleteBody {
  code?: unknown;
  password?: unknown;
}

const attemptLimiter = createRateLimiter("account-delete", 5, 15 * 60_000);

export async function POST(req: NextRequest) {
  // Same-origin / CSRF guard.
  if (!isSameOrigin(req)) {
    return errors.forbidden("Cross-origin request rejected", "CSRF_BLOCKED");
  }

  const { user, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  if (!user.email) {
    return errors.badRequest("Account has no email — cannot re-authenticate");
  }

  // Parse + validate body.
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return errors.badRequest("Invalid JSON body");
  }

  const code = typeof body.code === "string" ? body.code : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!code && !password) {
    return apiError("A code or a password is required to confirm deletion", {
      status: 400,
      code: "CONFIRMATION_REQUIRED",
    });
  }

  const { allowed } = await attemptLimiter.check(req, user.id);
  if (!allowed) {
    return errors.rateLimit("Too many attempts. Try again in a few minutes.");
  }

  if (code) {
    const result = await verifyDeletionCode(user.email, user.id, code);
    if (!result.ok) {
      if (result.kind === "rate_limit") {
        return errors.rateLimit("Too many attempts. Try again in a few minutes.");
      }
      if (result.kind === "network" || result.kind === "unknown") {
        return apiError("The code could not be checked. Try again.", {
          status: 503,
          code: "CODE_UNCHECKED",
        });
      }
      return apiError("The code is wrong or has expired", { status: 401, code: "CODE_INVALID" });
    }
  } else {
    // Step-up re-authentication. We use a fresh server client so this signIn
    // attempt does not clobber the active session cookie unless it succeeds.
    // signInWithPassword returns 400 with code "invalid_credentials" on a
    // bad password — that is the path we treat as 401.
    const verifyClient = await createClient();
    const { error: signInError } = await verifyClient.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (signInError) {
      console.warn(
        `[Profile Delete] Step-up auth failed for user ${user.id}: ${signInError.message}`
      );
      return apiError("Password is incorrect", { status: 401, code: "PASSWORD_INCORRECT" });
    }
  }

  const userId = user.id;
  const adminClient = createAdminClient();

  try {
    // Phase 1: transactional cascade across public schema.
    const { error: rpcError } = await adminClient.rpc(
      "delete_user_account",
      { p_user_id: userId }
    );

    if (rpcError) {
      console.error("[Profile Delete] RPC delete_user_account failed:", rpcError);
      return errors.internal("Failed to delete account data", "Profile Delete");
    }

    // Phase 2: auth-schema cleanup (separate API surface, not in-tx with
    // the public schema, so it runs after the cascade has committed).
    const { error: deleteAuthError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (deleteAuthError) {
      console.error(
        "[Profile Delete] auth.admin.deleteUser failed (public data already deleted):",
        deleteAuthError
      );
      return errors.internal(
        "Account data deleted but auth record removal failed. Contact support.",
        "Profile Delete"
      );
    }

    console.log(`[Profile Delete] Successfully deleted account for user: ${userId}`);

    return apiSuccess({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("[Profile Delete] Account deletion failed:", error);
    return errors.internal("Failed to delete account", "Profile Delete");
  }
}
