import type { NextRequest } from "next/server";
import { render } from "@react-email/render";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { isSameOrigin } from "@/lib/api/same-origin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { sendEmail } from "@/lib/email/client";
import { normalizeEmailLocale } from "@/lib/email/copy";
import DeleteAccountCodeEmail, {
  deleteAccountCodeEmailText,
  deleteAccountCodeSubject,
} from "@/lib/email/templates/DeleteAccountCode";

/**
 * POST /api/profile/delete/code
 *
 * Emails the signed-in user a six-digit code that confirms deleting their
 * account (see lib/auth/deletion-code.ts). Every account can get one,
 * including Google sign-ins, which have no password to confirm with.
 */

// A few resends are normal; more than that in 15 minutes is not.
const codeLimiter = createRateLimiter("account-delete-code", 3, 15 * 60_000);

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return errors.forbidden("Cross-origin request rejected", "CSRF_BLOCKED");
  }

  const { user, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  if (!user.email) {
    return errors.badRequest("Account has no email address");
  }

  const { allowed } = await codeLimiter.check(req, user.id);
  if (!allowed) {
    return errors.rateLimit("Too many codes requested. Try again in a few minutes.");
  }

  const body = (await req.json().catch(() => ({}))) as { locale?: unknown };
  const locale = normalizeEmailLocale(body?.locale);

  // generateLink mints the code without Supabase sending its own email.
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const code = data?.properties?.email_otp;
  if (error || !code) {
    console.error("[Profile Delete] Could not create a deletion code:", error?.message);
    return errors.internal("Could not create a code", "Profile Delete");
  }

  const props = { code, locale };
  const sent = await sendEmail({
    to: user.email,
    subject: deleteAccountCodeSubject(locale),
    html: await render(DeleteAccountCodeEmail(props)),
    text: deleteAccountCodeEmailText(props),
    tags: [{ name: "source", value: "account-delete-code" }],
  });
  if (!sent.ok) {
    console.error("[Profile Delete] Could not send the deletion code:", sent.error);
    return errors.internal("Could not send the code", "Profile Delete");
  }

  return apiSuccess({ sent: true });
}
