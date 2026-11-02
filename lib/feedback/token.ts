/**
 * Signed, stateless feedback-link tokens.
 *
 * Mirrors lib/email/unsubscribe.ts exactly:
 *   base64url(payload).base64url(hmac-sha256(secret, payloadB64))
 *
 * Encodes the recipient's user id + an expiry so an emailed
 * /feedback/<token> link can attribute a survey response to the right user
 * WITHOUT a logged-in session. A distinct purpose tag ("fb") means an
 * unsubscribe token can't be replayed as a feedback token, or vice-versa.
 *
 * Secret: FEEDBACK_LINK_SECRET if set, else EMAIL_UNSUBSCRIBE_SECRET — reuse
 * the already-provisioned email secret so shipping needs no new env var. If
 * neither is set, signing throws (we'd rather block the outreach send than
 * mint forgeable links).
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_DAYS = 30;
const PURPOSE = "fb" as const;

interface FeedbackPayload {
  u: string; // user_id
  t: typeof PURPOSE; // purpose tag — prevents cross-use with unsubscribe tokens
  e: number; // unix seconds expiry
}

function getSecret(): string {
  const s =
    process.env.FEEDBACK_LINK_SECRET || process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "FEEDBACK_LINK_SECRET / EMAIL_UNSUBSCRIBE_SECRET is not set (or too short). Set a random 32-byte hex string."
    );
  }
  return s;
}

/**
 * Mint a feedback-link token for a user. Expires `ttlDays` from now
 * (default 30 — outreach campaigns are time-boxed; a leaked old email
 * loses power quickly).
 */
export function signFeedbackToken(
  userId: string,
  ttlDays: number = DEFAULT_TTL_DAYS
): string {
  const payload: FeedbackPayload = {
    u: userId,
    t: PURPOSE,
    e: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const hmacB64 = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${hmacB64}`;
}

export interface FeedbackVerifyResult {
  ok: boolean;
  userId?: string;
  reason?: "format" | "signature" | "expired" | "secret_missing";
}

/**
 * Verify a feedback token. Returns the user id if valid; otherwise a
 * structured failure with a reason so the page can render a useful error
 * (expired vs forged). Never throws.
 */
export function verifyFeedbackToken(token: string): FeedbackVerifyResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "format" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "format" };

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    // LOUD ON PURPOSE. Every failure reason below renders the same "this link
    // has expired" page, which is the right message for a real expiry and a
    // LIE when the secret is unset: in that state every recipient of an
    // outreach email is told their link expired, the survey collects nothing,
    // and no user-visible signal distinguishes it from normal wear. This is an
    // ops failure, not a user error, so it belongs in the logs where the
    // health watcher and Sentry can see it.
    console.error(
      "[feedback/token] SIGNING SECRET MISSING — every /feedback/<token> link " +
        "is being rejected as expired. Set FEEDBACK_LINK_SECRET (or " +
        "EMAIL_UNSUBSCRIBE_SECRET) to a 32-byte hex string."
    );
    return { ok: false, reason: "secret_missing" };
  }

  const expectedHmac = createHmac("sha256", secret).update(parts[0]).digest();
  const providedHmac = Buffer.from(parts[1], "base64url");
  if (providedHmac.length !== expectedHmac.length) {
    return { ok: false, reason: "signature" };
  }
  if (!timingSafeEqual(providedHmac, expectedHmac)) {
    return { ok: false, reason: "signature" };
  }

  let payload: FeedbackPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as FeedbackPayload;
  } catch {
    return { ok: false, reason: "format" };
  }

  if (
    !payload.u ||
    typeof payload.u !== "string" ||
    payload.t !== PURPOSE ||
    typeof payload.e !== "number"
  ) {
    return { ok: false, reason: "format" };
  }
  if (payload.e * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, userId: payload.u };
}

/**
 * Build the absolute feedback-link URL for an outreach email. Locale-prefixes
 * the path for non-default locales (next-intl localePrefix: "as-needed" — the
 * default "en" has no prefix).
 */
export function buildFeedbackUrl(
  userId: string,
  locale: string = "en",
  appUrl?: string
): string {
  const base =
    appUrl ?? (process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app");
  const token = signFeedbackToken(userId);
  const prefix = locale && locale !== "en" ? `/${locale}` : "";
  return `${base}${prefix}/feedback/${token}`;
}
