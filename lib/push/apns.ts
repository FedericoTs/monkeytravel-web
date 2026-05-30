/**
 * APNs (Apple Push Notification service) HTTP/2 client.
 *
 * Why no SDK:
 *   - The official Apple SDK is iOS-only (Swift). Server-side
 *     "apn" / "node-apn" libraries exist but they're old (last
 *     meaningful update 2019), pull in legacy http2 abstractions,
 *     and obscure the actual auth flow which is two screens of code.
 *   - We need three things: a JWT signed with our team's .p8 key,
 *     a POST to api.push.apple.com over HTTP/2, and a status-code
 *     parser. Native `fetch` does HTTP/2 in Node 18+ + jose does the
 *     JWT. ~150 lines total — auditable in one sitting.
 *
 * Auth model:
 *   - One .p8 ES256 private key per Apple Developer team (downloaded
 *     once, never re-issued — store the contents in env).
 *   - JWT signed with the key. Header includes the `kid` (Key ID) and
 *     `alg=ES256`. Payload claims `iss` (Team ID) + `iat` (now).
 *   - Apple's docs say tokens are valid 20-60 minutes. We cache for
 *     50 minutes in the process to amortize the signing cost; on
 *     Vercel's stateless runtime that means one fresh JWT per cold
 *     container, which is fine.
 *
 * Env vars required (no-op without all four):
 *   - APNS_TEAM_ID            10-char Apple Team identifier
 *   - APNS_KEY_ID             10-char Key ID for the .p8
 *   - APNS_KEY_P8             contents of the .p8 file (PEM-encoded
 *                             private key). Newlines preserved.
 *   - APNS_BUNDLE_ID          app bundle id, e.g. app.monkeytravel
 *
 * Optional:
 *   - APNS_PRODUCTION         "true" to send to api.push.apple.com,
 *                             anything else routes to the sandbox at
 *                             api.sandbox.push.apple.com. Default
 *                             sandbox so dev sends don't hit real
 *                             devices.
 *
 * The dispatcher (lib/push/dispatch.ts) checks isApnsConfigured()
 * before calling — if env is missing the whole iOS path no-ops and
 * the dispatcher returns sentCount=0 for iOS rows without erroring.
 */

import { SignJWT, importPKCS8 } from "jose";
import type { NotificationPayload } from "./types";

const APNS_PROD = "https://api.push.apple.com";
const APNS_SANDBOX = "https://api.sandbox.push.apple.com";

// In-process JWT cache. APNs allows tokens up to 60 minutes; we
// rotate every 50 to leave a safety margin. Recomputed on cold start
// (Vercel stateless functions get a fresh container ~every minute
// of idle, so this is amortized only across burst traffic).
let cachedJwt: { token: string; expiresAt: number } | null = null;

export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_TEAM_ID &&
      process.env.APNS_KEY_ID &&
      process.env.APNS_KEY_P8 &&
      process.env.APNS_BUNDLE_ID
  );
}

/**
 * Mint a JWT for the Apple Push API. Cached for 50 minutes.
 */
async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) {
    return cachedJwt.token;
  }

  const teamId = process.env.APNS_TEAM_ID!;
  const keyId = process.env.APNS_KEY_ID!;
  // Vercel env injects newlines as literal "\n" when pasted; normalize
  // so importPKCS8 sees the PEM as the original .p8 file.
  const keyPem = process.env.APNS_KEY_P8!.replace(/\\n/g, "\n");

  const key = await importPKCS8(keyPem, "ES256");

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(key);

  cachedJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

/**
 * Result of a single APNs POST. The dispatcher reads `terminal` to
 * decide whether to suppress the token in the DB.
 */
export interface ApnsSendResult {
  /** True if APNs accepted the push into delivery (HTTP 200). */
  ok: boolean;
  /** True if the device is gone — caller MUST suppress the token. */
  terminal: boolean;
  /** APNs status code (200, 400, 410, 429, 5xx). */
  status: number;
  /** APNs reason string from the response body (or our internal error). */
  reason: string;
}

/**
 * Send one push to one device token via APNs HTTP/2.
 *
 * We send sequentially per-call rather than batching because APNs
 * doesn't support multi-recipient sends — every device is a separate
 * HTTP/2 stream. The dispatcher parallelizes across devices.
 */
export async function sendApns(
  token: string,
  payload: NotificationPayload
): Promise<ApnsSendResult> {
  if (!isApnsConfigured()) {
    return { ok: false, terminal: false, status: 0, reason: "apns_not_configured" };
  }

  const host =
    process.env.APNS_PRODUCTION === "true" ? APNS_PROD : APNS_SANDBOX;
  const url = `${host}/3/device/${token}`;

  let jwt: string;
  try {
    jwt = await getApnsJwt();
  } catch (err) {
    return {
      ok: false,
      terminal: false,
      status: 0,
      reason: `jwt_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Build APNs payload. The "aps" dict drives the system UI; the rest
  // becomes the `data` you read in didReceiveRemoteNotification.
  const apnsPayload: Record<string, unknown> = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      // Omit badge if not provided — APNs treats 0 as "clear badge" which
      // would wipe other apps' counts if we accidentally sent it.
      ...(typeof payload.badge === "number" && { badge: payload.badge }),
      sound: payload.sound ?? "default",
      // mutable-content: 1 lets a Notification Service Extension
      // modify the payload before display (rich media, image
      // download). Cheap to always set; harmless if no NSE installed.
      "mutable-content": 1,
    },
    ...(payload.data ?? {}),
    // Mirror the type into the data dict for tap-handling on the
    // native side (matches lib/push/types.ts NotificationPayload).
    notificationType: payload.type,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": process.env.APNS_BUNDLE_ID!,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": "0", // best-effort, expire if undeliverable
        "content-type": "application/json",
      },
      body: JSON.stringify(apnsPayload),
    });
  } catch (err) {
    // Network failure — non-terminal. Caller may retry on a later
    // notification; we don't suppress the token over transient errors.
    return {
      ok: false,
      terminal: false,
      status: 0,
      reason: `network_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Success path
  if (res.status === 200) {
    return { ok: true, terminal: false, status: 200, reason: "ok" };
  }

  // Parse the reason. APNs returns JSON {reason: "BadDeviceToken"|...}
  let reason = "unknown";
  try {
    const body = (await res.json()) as { reason?: string };
    if (body.reason) reason = body.reason;
  } catch {
    /* non-JSON body; leave "unknown" */
  }

  // Terminal errors: the token is dead and we should never use it
  // again. Suppress immediately in the DB.
  // Per https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
  const terminalReasons = new Set([
    "BadDeviceToken",
    "DeviceTokenNotForTopic",
    "Unregistered",
    "ExpiredProviderToken", // our JWT expired; transient but signals re-mint
    "TopicDisallowed",
    "BadCertificate",
    "Forbidden",
  ]);

  // 410 Gone is always terminal regardless of reason text.
  const terminal = res.status === 410 || terminalReasons.has(reason);

  return { ok: false, terminal, status: res.status, reason };
}
