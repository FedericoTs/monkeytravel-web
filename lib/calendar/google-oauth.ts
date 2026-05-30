/**
 * Google Calendar OAuth helpers.
 *
 * Phase 2 of calendar-export. We do NOT pull in `googleapis` for this —
 * the OAuth dance is six form-urlencoded POSTs we can drive with
 * `fetch`, and not adding a 300 KB SDK keeps the cold-start small.
 *
 * Three things live here:
 *   1. env validation (`getGoogleOAuthConfig`) — single source of truth
 *      for redirect URI + client id/secret + scope. Throws helpful
 *      errors when env is missing so the routes can 503 cleanly.
 *   2. state HMAC (`signState` / `verifyState`) — packs the trip_id +
 *      a 16-byte CSRF nonce into a single signed string carried
 *      across the OAuth redirect. CSRF cookie pattern from the PRD,
 *      but here in HMAC form so we don't rely on cross-domain cookies
 *      surviving Google's redirect (Lax/Strict + first-party context).
 *   3. PKCE helpers (`createPkcePair`) — code_verifier +
 *      code_challenge S256. Required by Google for "Authorization
 *      Code with PKCE" flow on confidential clients too (best
 *      practice; mitigates code interception).
 *
 * Token exchange (`exchangeCodeForTokens`) + refresh
 * (`refreshAccessToken`) round out the surface so the callback /
 * sync routes don't have to remember Google's exact endpoint URLs.
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Env / config
// ---------------------------------------------------------------------------

export const GOOGLE_CALENDAR_SCOPE =
  // calendar.events = write events on existing calendars. Narrower
  // than `calendar` (full access). Matches PRD §"Security review".
  "https://www.googleapis.com/auth/calendar.events";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
};

/**
 * Returns null if the OAuth env isn't fully configured. Routes
 * use this to return a 503 with a clear "Calendar sync not
 * configured" message rather than throwing 500s on every connect.
 *
 * Required env:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI    (defaults to
 *                                 https://monkeytravel.app/api/calendar/google/callback)
 *   CALENDAR_OAUTH_STATE_SECRET  (HMAC key for the state param;
 *                                 generate via `openssl rand -hex 32`)
 *   CALENDAR_TOKEN_ENC_KEY       (validated in token-encryption.ts —
 *                                 we don't re-check here)
 */
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    "https://monkeytravel.app/api/calendar/google/callback";

  return {
    clientId,
    clientSecret,
    redirectUri,
    scope: GOOGLE_CALENDAR_SCOPE,
  };
}

/**
 * True iff the OAuth state HMAC secret is configured. Used by the
 * connect/callback routes' early 503 path.
 */
export function isOAuthStateSecretConfigured(): boolean {
  const v = process.env.CALENDAR_OAUTH_STATE_SECRET;
  return typeof v === "string" && v.length >= 16;
}

function getStateSecret(): string {
  const v = process.env.CALENDAR_OAUTH_STATE_SECRET;
  if (!v || v.length < 16) {
    throw new Error(
      "CALENDAR_OAUTH_STATE_SECRET is not set (or shorter than 16 chars). Generate with `openssl rand -hex 32`."
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// State HMAC
// ---------------------------------------------------------------------------

/**
 * Encoded as `<base64url(payload)>.<base64url(hmac)>`.
 *
 * Payload layout (JSON):
 *   { u: userId, t: tripId, n: nonceHex, x: expiresAtMs }
 *
 * - userId binding prevents the "attacker starts the OAuth dance,
 *   victim completes it" cross-account replay.
 * - tripId is what we sync to after callback.
 * - nonce is 16 random bytes — defends against state-reuse if
 *   somebody fishes a state out of a URL.
 * - expiresAtMs caps state validity to 10 minutes (OAuth dance is
 *   seconds in practice; 10m gives the user time to consent + pick
 *   an account).
 */
export type OAuthStatePayload = {
  userId: string;
  tripId: string;
};

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function signState(payload: OAuthStatePayload): string {
  const inner = {
    u: payload.userId,
    t: payload.tripId,
    n: randomBytes(16).toString("hex"),
    x: Date.now() + STATE_TTL_MS,
  };
  const body = base64url(JSON.stringify(inner));
  const mac = base64url(
    createHmac("sha256", getStateSecret()).update(body).digest()
  );
  return `${body}.${mac}`;
}

export type VerifiedState =
  | { ok: true; payload: OAuthStatePayload; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad_mac" | "expired" };

export function verifyState(state: string | null | undefined): VerifiedState {
  if (typeof state !== "string" || !state.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [body, mac] = state.split(".", 2);
  if (!body || !mac) return { ok: false, reason: "malformed" };

  const expected = base64url(
    createHmac("sha256", getStateSecret()).update(body).digest()
  );
  // timingSafeEqual throws on length mismatch; pre-check first.
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length) {
    return { ok: false, reason: "bad_mac" };
  }
  if (!timingSafeEqual(macBuf, expBuf)) {
    return { ok: false, reason: "bad_mac" };
  }

  let inner: { u?: unknown; t?: unknown; x?: unknown };
  try {
    inner = JSON.parse(base64urlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof inner.u !== "string" ||
    typeof inner.t !== "string" ||
    typeof inner.x !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() > inner.x) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    payload: { userId: inner.u, tripId: inner.t },
    expiresAt: inner.x,
  };
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

export type PkcePair = {
  /** Random URL-safe high-entropy string we keep server-side via state. */
  verifier: string;
  /** SHA-256(verifier), base64url — sent to /authorize. */
  challenge: string;
};

export function createPkcePair(): PkcePair {
  // RFC 7636 §4.1: 43-128 chars. 64 random bytes → 86 base64url chars.
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Authorization URL build
// ---------------------------------------------------------------------------

/**
 * Build the Google OAuth consent URL. The caller redirects to this.
 *
 * `access_type=offline + prompt=consent` is critical — without
 * `prompt=consent` Google won't reissue a refresh_token on the
 * second-and-later consent, leaving the user "connected" but
 * un-refreshable. We always want a fresh refresh_token on a connect
 * action.
 */
export function buildAuthorizationUrl(opts: {
  config: GoogleOAuthConfig;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.config.clientId,
    redirect_uri: opts.config.redirectUri,
    response_type: "code",
    scope: opts.config.scope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) {
    params.set("login_hint", opts.loginHint);
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange + refresh
// ---------------------------------------------------------------------------

export type GoogleTokens = {
  access_token: string;
  /** ISO timestamp the access_token expires at. */
  expires_at: string;
  refresh_token: string;
  scope: string;
  /** Google account email if returned via id_token decode. */
  email?: string;
};

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Exchange the `code` from the callback for a token pair. Uses PKCE,
 * so we send `code_verifier` not `client_secret`-only (per Google
 * recommendation for OAuth 2.1).
 */
export async function exchangeCodeForTokens(opts: {
  config: GoogleOAuthConfig;
  code: string;
  codeVerifier: string;
}): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.config.clientId,
    client_secret: opts.config.clientSecret,
    redirect_uri: opts.config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `Google token exchange failed: ${res.status} ${res.statusText} :: ${text.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      "Google token exchange returned no access_token/refresh_token — " +
        "did the user previously consent without prompt=consent? " +
        "We force prompt=consent on /connect to avoid this."
    );
  }
  const expiresInSec =
    typeof json.expires_in === "number" ? json.expires_in : 3600;
  const email = json.id_token ? extractEmailFromIdToken(json.id_token) : undefined;
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    scope: json.scope ?? GOOGLE_CALENDAR_SCOPE,
    email,
  };
}

/**
 * Use the long-lived refresh_token to mint a new access_token. Phase
 * 2 only uses this in `google-sync.ts` if the stored access_token
 * has expired (rare — sync runs immediately after callback).
 */
export async function refreshAccessToken(opts: {
  config: GoogleOAuthConfig;
  refreshToken: string;
}): Promise<{ access_token: string; expires_at: string; scope: string }> {
  const body = new URLSearchParams({
    refresh_token: opts.refreshToken,
    client_id: opts.config.clientId,
    client_secret: opts.config.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `Google token refresh failed: ${res.status} ${res.statusText} :: ${text.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new Error("Google token refresh returned no access_token");
  }
  const expiresInSec =
    typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    access_token: json.access_token,
    expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    scope: json.scope ?? GOOGLE_CALENDAR_SCOPE,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

/**
 * Pull the `email` claim out of a Google id_token JWT. We don't
 * verify signature — it's coming straight from Google's HTTPS
 * token endpoint, so the transport authenticates the issuer. We
 * only use it for display ("connected as foo@gmail.com").
 */
function extractEmailFromIdToken(idToken: string): string | undefined {
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(base64urlDecode(parts[1]).toString("utf8"));
    return typeof payload?.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}
