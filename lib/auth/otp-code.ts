/**
 * The in-tab half of email sign-in: a six-digit code the user types here
 * instead of leaving for their mail app.
 *
 * WHY THIS EXISTS
 * ---------------
 * A sign-up that stays in the tab (Google) gets people in far more often than
 * one that leaves for the mail (a magic link), and the same mechanism shows
 * up by device: mobile planners click Save as often as desktop ones, but are
 * more exposed to "leave the browser, come back somewhere else". It is not the
 * cross-device confirmation issue (the link uses token_hash + verifyOtp) and
 * not the modal. What was missing is any email path that keeps the user
 * where they already are.
 *
 * THE CODE WAS ALREADY THERE
 * --------------------------
 * Supabase's Send Email hook posts `email_data.token` — the six-digit code —
 * on every auth email, and lib/email/templates/AuthAction.tsx already prints
 * it. Two things were missing, not one:
 *
 *   1. ConfirmSignup (the template NEW users get, because the modal calls
 *      signInWithOtp with shouldCreateUser: true) took no token at all, so
 *      exactly the people being lost never received a code.
 *   2. Nothing in the app accepted one.
 *
 * Everything here is a pure function of its input so the parsing and the
 * type-order rules can be tested without a Supabase client.
 */

/** Codes are always six digits; Supabase rejects anything else outright. */
export const OTP_CODE_LENGTH = 6;

/**
 * Keep only digits, capped at six.
 *
 * People paste "123 456", "123-456", and whole sentences out of the email
 * ("Or enter this code: 123456"). Every one of those should work — rejecting
 * a paste that plainly contains the right code is the sort of small refusal
 * that sends someone back to the mail app, which is the exact trip this
 * feature exists to avoid.
 */
export function normalizeOtpCode(raw: string): string {
  return (raw ?? "").replace(/\D+/g, "").slice(0, OTP_CODE_LENGTH);
}

/** Ready to submit: exactly six digits. */
export function isCompleteOtpCode(code: string): boolean {
  return new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code);
}

export type OtpErrorKind = "invalid" | "expired" | "rate_limit" | "network" | "unknown";

/**
 * Bucket a Supabase error so the user gets copy that tells them what to do.
 *
 * "expired" and "invalid" need different sentences — one means ask for a new
 * code, the other means check the digits — and a rate limit must never be
 * dressed up as a wrong code, or the user will sit there retyping a code that
 * was right the whole time.
 */
export function classifyOtpError(
  message: string | undefined | null,
  status?: number | null,
): OtpErrorKind {
  // A 5xx never looked at the code (/auth/v1/verify can answer 504 while the
  // instance is swapping): reported as a wrong code, it sends the user to the
  // emailed link in another browser, where the trip they just built is never
  // claimed.
  if (typeof status === "number" && status >= 500) return "network";
  const m = (message ?? "").toLowerCase();
  if (!m) return "unknown";
  if (m.includes("expired") || m.includes("has expired")) return "expired";
  if (
    m.includes("gateway") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("unavailable") ||
    /\b50[0-4]\b/.test(m)
  ) {
    return "network";
  }
  // "For security purposes, you can only request this after 60 seconds" is
  // GoTrue's own throttle wording and carries none of the obvious tokens.
  // Users hit it routinely — the project-wide auth-email cap is small — and
  // reading it as anything else tells them to re-check a code that was fine.
  if (
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("429") ||
    m.includes("for security purposes") ||
    m.includes("you can only request this after")
  ) {
    return "rate_limit";
  }
  if (m.includes("invalid") || m.includes("token not found") || m.includes("incorrect")) return "invalid";
  if (m.includes("network") || m.includes("fetch")) return "network";
  return "unknown";
}

/**
 * Supabase types a code by the email that carried it, and the client cannot
 * know which was sent: `signInWithOtp({ shouldCreateUser: true })` produces a
 * `signup` confirmation for a new address and a `magiclink` for one that
 * already exists. So try in order and stop at the first that works.
 *
 * Order is deliberate: `email` is the documented type for a code obtained via
 * signInWithOtp and covers the common case in one call, so the usual path
 * costs a single request.
 */
export const OTP_VERIFY_TYPES = ["email", "signup", "magiclink"] as const;
export type OtpVerifyType = (typeof OTP_VERIFY_TYPES)[number];

/**
 * Whether a failure of one type is worth retrying as the next.
 *
 * ONLY on "invalid" — that is what a correct code submitted under the wrong
 * type looks like. An expired code is expired under every type, and retrying
 * a rate limit spends the user's remaining attempts to arrive at the same
 * wall three times faster.
 */
export function shouldTryNextType(kind: OtpErrorKind): boolean {
  return kind === "invalid";
}

/**
 * Whether a failure is worth one more attempt under the SAME type.
 *
 * ONLY on "network" — the request never reached a verdict, so the code is
 * still good and nothing has been spent. One retry, not a loop: if the
 * gateway is down for longer than a beat, the emailed link is the real
 * fallback and the user should be told, not kept waiting on a spinner.
 */
export const OTP_TRANSIENT_RETRY_DELAY_MS = 1500;

export function shouldRetrySameType(kind: OtpErrorKind): boolean {
  return kind === "network";
}

/**
 * The i18n key for a failure. Kept beside the classifier so a new bucket
 * cannot be added without someone noticing the missing string.
 */
export function otpErrorMessageKey(kind: OtpErrorKind): string {
  switch (kind) {
    case "expired":
      return "magicLink.codeExpired";
    case "rate_limit":
      return "magicLink.codeRateLimited";
    case "network":
      return "magicLink.codeNetwork";
    case "invalid":
      return "magicLink.codeInvalid";
    default:
      return "magicLink.codeFailed";
  }
}
