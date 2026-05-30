/**
 * FCM (Firebase Cloud Messaging) HTTP v1 API client.
 *
 * Why no firebase-admin SDK:
 *   - firebase-admin pulls in ~4-5 MB of code (Firestore, Storage,
 *     RTDB, etc.) we don't use. Not viable to bundle into Vercel
 *     serverless functions where cold-start size matters.
 *   - The HTTP v1 API is well-documented and stable. Auth = service
 *     account JWT → access token → POST. ~180 lines total.
 *
 * Auth model:
 *   - One Google Service Account JSON per Firebase project, with the
 *     `Firebase Cloud Messaging API` role. Downloaded once, stored
 *     in env as compact JSON.
 *   - We sign a JWT with the service account's private key (RS256),
 *     exchange it at https://oauth2.googleapis.com/token for a short-
 *     lived (3600s) access token, then use that access token on
 *     subsequent send requests.
 *   - Cache the access token in-process for 50 minutes to amortize
 *     the OAuth exchange. Same trade-off as APNs.
 *
 * Env vars required (no-op without both):
 *   - FCM_PROJECT_ID                  Firebase project ID (string)
 *   - FCM_SERVICE_ACCOUNT_JSON        Full service-account JSON
 *                                     (paste as one line; we parse).
 *                                     Includes private_key with PEM
 *                                     wrapper + escaped newlines.
 *
 * The dispatcher checks isFcmConfigured() before calling.
 */

import { SignJWT, importPKCS8 } from "jose";
import type { NotificationPayload } from "./types";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// In-process token cache.
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function isFcmConfigured(): boolean {
  return Boolean(
    process.env.FCM_PROJECT_ID && process.env.FCM_SERVICE_ACCOUNT_JSON
  );
}

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON!;
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FCM service account missing client_email/private_key");
  }
  return parsed;
}

/**
 * Exchange the service account credentials for an OAuth2 access
 * token. Caches in-process for 50 minutes.
 */
async function getFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const sa = loadServiceAccount();
  // Vercel env normalization — when service-account JSON is pasted via
  // the dashboard, newlines in the private_key may arrive as "\n"
  // literals. Restore.
  const keyPem = sa.private_key.replace(/\\n/g, "\n");

  const key = await importPKCS8(keyPem, "RS256");

  // Build the assertion JWT per
  // https://developers.google.com/identity/protocols/oauth2/service-account#authorizingrequests
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri ?? GOOGLE_TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  // Exchange for an access token.
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  let res: Response;
  try {
    res = await fetch(sa.token_uri ?? GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err) {
    throw new Error(
      `FCM oauth exchange network error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(`FCM oauth exchange ${res.status}: ${body.slice(0, 200)}`);
  }

  const tokenResp = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenResp.access_token) {
    throw new Error("FCM oauth response missing access_token");
  }

  cachedAccessToken = {
    token: tokenResp.access_token,
    // Cache for shorter of {Google's expires_in - 60s, 50 minutes}.
    // Defensive: Google returns 3600 today but never assume.
    expiresAt: now + Math.min((tokenResp.expires_in ?? 3600) - 60, 50 * 60),
  };
  return cachedAccessToken.token;
}

export interface FcmSendResult {
  ok: boolean;
  terminal: boolean;
  status: number;
  reason: string;
}

/**
 * Send one push to one FCM token via HTTP v1.
 *
 * Parallelized by the dispatcher across tokens. FCM v1 supports
 * batch via /messages:batchSend but the per-message error reporting
 * is harder to map back to individual tokens — sequential per-token
 * trades small throughput for clearer dispatch_log accounting.
 */
export async function sendFcm(
  token: string,
  payload: NotificationPayload
): Promise<FcmSendResult> {
  if (!isFcmConfigured()) {
    return { ok: false, terminal: false, status: 0, reason: "fcm_not_configured" };
  }

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken();
  } catch (err) {
    return {
      ok: false,
      terminal: false,
      status: 0,
      reason: `oauth_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const projectId = process.env.FCM_PROJECT_ID!;
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  // FCM v1 message shape:
  // https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages
  const message: Record<string, unknown> = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    // data values MUST be strings per the FCM spec. Coerce numbers and
    // booleans, drop undefined. The native client casts back on receipt.
    data: Object.fromEntries(
      Object.entries({
        ...(payload.data ?? {}),
        notificationType: payload.type,
      })
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: "high",
      ...(payload.sound && {
        notification: { sound: payload.sound },
      }),
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
  } catch (err) {
    return {
      ok: false,
      terminal: false,
      status: 0,
      reason: `network_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (res.status === 200) {
    return { ok: true, terminal: false, status: 200, reason: "ok" };
  }

  // FCM error body:
  // { error: { code: number, message: string, status: string,
  //            details: [{ errorCode: "UNREGISTERED" | ... }] } }
  let reason = "unknown";
  let errorCode: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: {
        message?: string;
        status?: string;
        details?: Array<{ errorCode?: string }>;
      };
    };
    if (body.error?.details) {
      errorCode = body.error.details.find((d) => d.errorCode)?.errorCode;
    }
    reason = errorCode ?? body.error?.status ?? body.error?.message ?? "unknown";
  } catch {
    /* non-JSON body; leave "unknown" */
  }

  // Terminal — the token is dead.
  // Per https://firebase.google.com/docs/cloud-messaging/manage-tokens
  const terminalCodes = new Set([
    "UNREGISTERED",
    "INVALID_ARGUMENT",
    "SENDER_ID_MISMATCH",
    "NOT_FOUND",
  ]);
  const terminal =
    res.status === 404 ||
    (res.status === 400 && errorCode === "INVALID_ARGUMENT") ||
    (errorCode !== undefined && terminalCodes.has(errorCode));

  return { ok: false, terminal, status: res.status, reason };
}
