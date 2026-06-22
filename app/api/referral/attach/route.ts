import { getAuthenticatedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * POST /api/referral/attach
 *
 * Validated referral attribution for the EMAIL instant-session signup path
 * (email confirmation disabled → the client holds a session immediately but
 * can't run a service-role RPC). OAuth and confirm-email signups attach
 * server-side in app/auth/callback/route.ts instead.
 *
 * Delegates to the atomic, idempotent, service-role-guarded
 * attach_referral_on_signup RPC (migration 20260621): it validates the code,
 * stamps users.referred_by_code (canonical casing), increments
 * referral_codes.total_signups (the K-Factor numerator), logs the `signup`
 * referral_event, and grants the referee's 30🍌 welcome gift. Self-referral
 * and unknown codes return { attributed: false } and write nothing.
 */
export async function POST(request: Request) {
  const { user, errorResponse } = await getAuthenticatedUser();
  if (errorResponse || !user) {
    return errorResponse ?? errors.unauthorized();
  }

  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return apiSuccess({ attributed: false });
  }
  if (!code || typeof code !== "string") {
    return apiSuccess({ attributed: false });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("attach_referral_on_signup", {
    p_user_id: user.id,
    p_code: code,
  });

  if (error) {
    console.error("[Referral Attach] RPC failed:", error.message);
    return errors.internal("Failed to attach referral", "Referral Attach");
  }

  // RPC returns TABLE(attributed, referrer_id) → first row.
  return apiSuccess(data?.[0] ?? { attributed: false });
}
