/**
 * Standard Webhooks signature verification for the Supabase "Send Email"
 * auth hook (https://www.standardwebhooks.com/).
 *
 * Supabase signs each hook delivery with a symmetric secret (shown in the
 * dashboard as `v1,whsec_<base64>`). We verify:
 *   1. The HMAC-SHA256 signature over `${id}.${timestamp}.${rawBody}`.
 *   2. The timestamp is within a tolerance window (replay defence).
 *
 * Implemented with Node's crypto (no extra dependency) and a constant-time
 * compare. Returns a discriminated result rather than throwing so the route
 * can map failures to the right HTTP status.
 */

import crypto from "node:crypto";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

const TOLERANCE_SECONDS = 5 * 60; // reject deliveries older/newer than ±5m

/**
 * Normalise the configured secret to its raw base64 form. The dashboard
 * value is typically `v1,whsec_<base64>`; the standardwebhooks libraries
 * accept the bare `<base64>`. We strip whichever prefixes are present.
 */
function normaliseSecret(secret: string): string {
  let s = secret.trim();
  if (s.startsWith("v1,")) s = s.slice(3);
  if (s.startsWith("whsec_")) s = s.slice("whsec_".length);
  return s;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyHookSignature(
  rawBody: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing webhook headers" };
  }

  // Replay window check.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid timestamp" };
  }
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  // Compute expected signature.
  const key = Buffer.from(normaliseSecret(secret), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", key)
    .update(signedContent)
    .digest("base64");

  // The header is a space-delimited list of `v<version>,<base64sig>` items.
  // Any one valid v1 signature is sufficient.
  const passed = signature
    .split(" ")
    .some((part) => {
      const comma = part.indexOf(",");
      const sig = comma === -1 ? part : part.slice(comma + 1);
      return timingSafeEqualStr(sig, expected);
    });

  return passed ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
