import { createClient } from "@supabase/supabase-js";
import {
  OTP_VERIFY_TYPES,
  classifyOtpError,
  isCompleteOtpCode,
  normalizeOtpCode,
  shouldTryNextType,
  type OtpErrorKind,
  type OtpVerifyType,
} from "./otp-code";

/**
 * The emailed code that confirms deleting an account.
 *
 * Every account can receive one, including Google sign-ins, which have no
 * password to confirm with. The code comes from `admin.generateLink`, so
 * Supabase sends no sign-in email of its own, and it is checked here, on the
 * server, before anything is deleted.
 */

export type DeletionCodeResult =
  | { ok: true }
  | { ok: false; kind: OtpErrorKind };

export type VerifyCode = (args: {
  email: string;
  token: string;
  type: OtpVerifyType;
}) => Promise<{
  userId: string | null;
  error: { message?: string; status?: number } | null;
}>;

/**
 * Redeems the code for `email` and checks that it belongs to `userId`, the
 * signed-in user. Types are tried in the same order as the sign-in code, and
 * only a code rejected as invalid is tried again under the next type.
 */
export async function verifyDeletionCode(
  email: string,
  userId: string,
  rawCode: string,
  verify: VerifyCode = verifyWithSupabase,
): Promise<DeletionCodeResult> {
  const token = normalizeOtpCode(rawCode);
  if (!isCompleteOtpCode(token)) return { ok: false, kind: "invalid" };

  let kind: OtpErrorKind = "invalid";
  for (const type of OTP_VERIFY_TYPES) {
    const { userId: verifiedId, error } = await verify({ email, token, type });
    if (!error) {
      return verifiedId === userId ? { ok: true } : { ok: false, kind: "invalid" };
    }
    kind = classifyOtpError(error.message, error.status);
    if (!shouldTryNextType(kind)) break;
  }
  return { ok: false, kind };
}

// A client that keeps no session, so redeeming the code never touches the
// visitor's own cookies. The session it opens is removed with the account.
const verifyWithSupabase: VerifyCode = async ({ email, token, type }) => {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.verifyOtp({ email, token, type });
  return {
    userId: data?.user?.id ?? null,
    error: error ? { message: error.message, status: error.status } : null,
  };
};
