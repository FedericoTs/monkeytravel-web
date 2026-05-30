/**
 * One-click unsubscribe tokens.
 *
 * Signed-stateless tokens — the token IS the database of "this user
 * asked to unsubscribe from X." We don't store outstanding tokens; we
 * just verify the HMAC + check the expiry + flip the preference.
 *
 * Token format:
 *   base64url(payload).base64url(hmac-sha256(secret, payload))
 *
 * payload (JSON):
 *   {
 *     "u": "<user_id>",
 *     "k": "<settings_key>",   // e.g. "weeklyDigest" or "all"
 *     "e": <unix_seconds_expiry>
 *   }
 *
 * Why base64url and not JWT: simpler, smaller, no dependency, no key-id
 * rotation surface. The threat model is "someone forwards the email
 * with the link in it" — covered by expiry. JWT's extra structure buys
 * us nothing.
 *
 * Secret: `EMAIL_UNSUBSCRIBE_SECRET` env var, expected to be a random
 * 32+ byte hex string. If unset, signing throws (we'd rather block sends
 * than emit forgeable unsubscribe links).
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_DAYS = 365;

/**
 * Settings keys an unsubscribe token can target. "all" is the master-off
 * shortcut (sets emailNotifications=false). Per-type values match the
 * keys in the preference center (see NotificationPreferencesClient.tsx).
 */
export type UnsubKey =
  | "all"
  | "collabVotes"
  | "collabProposals"
  | "collabComments"
  | "inviteAccepted"
  | "weeklyDigest"
  | "marketingNotifications"
  // Pre-trip cascade (14d / 7d / 3d / 1d / morning-of). Gates the
  // TripReminderEmail dispatch path. Mirrors the existing
  // notification_settings.tripReminders key already populated at signup.
  | "tripReminders";

interface UnsubPayload {
  u: string; // user_id
  k: UnsubKey;
  e: number; // unix seconds
}

function getSecret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "EMAIL_UNSUBSCRIBE_SECRET is not set (or too short). Set a random 32-byte hex string."
    );
  }
  return s;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

/**
 * Mint an unsubscribe token for a (user, key) pair. Expires `ttlDays`
 * from now (default 365 — long enough to survive forwarded emails, short
 * enough that an old leaked email loses power).
 */
export function signUnsubscribeToken(
  userId: string,
  key: UnsubKey,
  ttlDays: number = DEFAULT_TTL_DAYS
): string {
  const payload: UnsubPayload = {
    u: userId,
    k: key,
    e: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(payloadJson, "utf8"));
  const hmacB64 = b64urlEncode(
    createHmac("sha256", getSecret()).update(payloadB64).digest()
  );
  return `${payloadB64}.${hmacB64}`;
}

export interface VerifyResult {
  ok: boolean;
  payload?: UnsubPayload;
  reason?: "format" | "signature" | "expired" | "secret_missing";
}

/**
 * Verify a token. Returns the payload if valid; otherwise structured
 * failure with a reason code so the caller can show a useful error
 * page (expired vs forged etc).
 *
 * Never throws — caller can render a clean error UI either way.
 */
export function verifyUnsubscribeToken(token: string): VerifyResult {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "format" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "format" };

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, reason: "secret_missing" };
  }

  const expectedHmac = createHmac("sha256", secret)
    .update(parts[0])
    .digest();
  let providedHmac: Buffer;
  try {
    providedHmac = b64urlDecode(parts[1]);
  } catch {
    return { ok: false, reason: "format" };
  }

  if (providedHmac.length !== expectedHmac.length) {
    return { ok: false, reason: "signature" };
  }
  if (!timingSafeEqual(providedHmac, expectedHmac)) {
    return { ok: false, reason: "signature" };
  }

  let payload: UnsubPayload;
  try {
    const json = b64urlDecode(parts[0]).toString("utf8");
    payload = JSON.parse(json) as UnsubPayload;
  } catch {
    return { ok: false, reason: "format" };
  }

  if (
    !payload.u ||
    typeof payload.u !== "string" ||
    !payload.k ||
    typeof payload.k !== "string" ||
    typeof payload.e !== "number"
  ) {
    return { ok: false, reason: "format" };
  }

  if (payload.e * 1000 < Date.now()) {
    return { ok: false, reason: "expired", payload };
  }

  return { ok: true, payload };
}

/**
 * Build the absolute unsubscribe URL. Use this in email templates'
 * List-Unsubscribe header + footer.
 */
export function buildUnsubscribeUrl(
  userId: string,
  key: UnsubKey,
  appUrl?: string
): string {
  const base = appUrl ?? (process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app");
  const token = signUnsubscribeToken(userId, key);
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Map UnsubKey → users.notification_settings field to flip. "all" gets
 * special-cased — it sets the master switch.
 */
export function unsubKeyToSettingPatch(key: UnsubKey): Record<string, boolean> {
  if (key === "all") return { emailNotifications: false };
  return { [key]: false };
}
