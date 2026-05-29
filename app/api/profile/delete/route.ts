import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

/**
 * POST /api/profile/delete
 *
 * Permanently deletes the authenticated user's account and all associated data.
 *
 * Security:
 * - Step-up auth: caller must re-supply their password via signInWithPassword
 *   before the cascade runs. Defeats same-origin XSS / malicious extensions
 *   that can ride an existing session cookie.
 * - Same-origin check via Sec-Fetch-Site (or Origin fallback). Browsers set
 *   Sec-Fetch-Site=same-origin only when the request was actually issued
 *   from a same-origin context — extensions and cross-origin scripts get
 *   "cross-site" or "none".
 * - Confirmation text required ("delete my account").
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
  confirmationText?: unknown;
  password?: unknown;
}

const REQUIRED_CONFIRMATION = "delete my account";

function isSameOrigin(req: NextRequest): boolean {
  // Prefer Sec-Fetch-Site (modern browsers, set by the user agent and
  // cannot be spoofed by page JS via fetch).
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) {
    return fetchSite === "same-origin";
  }

  // Fallback: compare Origin against the request URL host. Older browsers
  // or non-browser clients may omit Sec-Fetch-Site.
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    const targetHost = new URL(req.url).host;
    return originHost === targetHost;
  } catch {
    return false;
  }
}

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

  const confirmationText =
    typeof body.confirmationText === "string"
      ? body.confirmationText.trim().toLowerCase()
      : "";
  const password =
    typeof body.password === "string" ? body.password : "";

  if (confirmationText !== REQUIRED_CONFIRMATION) {
    return errors.badRequest(
      `Confirmation text must be exactly: ${REQUIRED_CONFIRMATION}`
    );
  }
  if (!password || password.length < 1) {
    return errors.badRequest("Password is required to confirm deletion");
  }

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
    return errors.unauthorized("Password is incorrect");
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
