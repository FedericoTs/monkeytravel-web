/**
 * GET /api/calendar/google/connect?trip_id=<uuid>
 *
 * Phase 2 of calendar-export. Kicks off the Google Calendar OAuth
 * dance for the currently-signed-in user, binding the eventual
 * callback to a specific trip via a signed `state` parameter.
 *
 * Flow:
 *   1. Validate the feature is enabled + env is configured. If not,
 *      503 with a clear "Calendar sync not configured" message —
 *      lets the operator see misconfig in Sentry without 500ing.
 *   2. Authenticate via Supabase session (must be signed-in).
 *   3. Validate trip_id query param + ownership/collaborator membership.
 *   4. Mint PKCE pair (verifier kept in cookie, challenge in URL).
 *   5. Sign `state = HMAC(userId|tripId|nonce|exp)`.
 *   6. Set short-lived httpOnly cookies for { code_verifier, state }
 *      so the callback can prove session continuity *and* enforce
 *      "same browser that started" CSRF protection.
 *   7. 302 to Google's consent screen.
 *
 * Hard guarantees:
 *   - We never proceed without an authenticated session — the
 *     callback will re-check `user.id === state.payload.userId`.
 *   - PKCE means even if `code` leaks in transit, no token exchange
 *     succeeds without the `code_verifier` cookie.
 *
 * Runtime: nodejs (uses node:crypto via lib/calendar/google-oauth.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildAuthorizationUrl,
  createPkcePair,
  getGoogleOAuthConfig,
  isOAuthStateSecretConfigured,
  signState,
} from "@/lib/calendar/google-oauth";
import { isTokenEncryptionConfigured } from "@/lib/calendar/token-encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 10 minute cap — must match STATE_TTL_MS in google-oauth.ts.
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

const COOKIE_STATE = "mt_gcal_oauth_state";
const COOKIE_VERIFIER = "mt_gcal_oauth_verifier";

function configError(message: string) {
  // 503 — distinguishes "operator hasn't set env" from "user did
  // something wrong". Frontend should fall back to the .ics export
  // UX and surface a non-fatal banner.
  return NextResponse.json(
    { error: "Calendar sync not configured", detail: message },
    { status: 503 }
  );
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const featureEnabled =
    process.env.NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED === "true";
  if (!featureEnabled) {
    // Stay quiet — feature flag off means UI shouldn't have surfaced
    // this URL. Return 404 not 503 to avoid leaking the route shape.
    return new NextResponse(null, { status: 404 });
  }

  const config = getGoogleOAuthConfig();
  if (!config) {
    return configError(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET env vars are missing."
    );
  }
  if (!isOAuthStateSecretConfigured()) {
    return configError("CALENDAR_OAUTH_STATE_SECRET env var is missing.");
  }
  if (!isTokenEncryptionConfigured()) {
    // Reject early — there's no point sending the user through OAuth
    // if we can't store the resulting tokens.
    return configError("CALENDAR_TOKEN_ENC_KEY env var is missing.");
  }

  // ---- Auth ----
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return unauthorized();

  // ---- Validate trip_id + ownership ----
  const url = new URL(request.url);
  const tripId = url.searchParams.get("trip_id");
  if (!tripId || !/^[0-9a-f-]{36}$/i.test(tripId)) {
    return badRequest("Missing or invalid trip_id");
  }

  // Owner OR collaborator can connect their own Google to this trip.
  // The collaborator path matches the trip-visibility model — if you
  // can see a trip in the app, you can push it to YOUR calendar.
  const { data: ownedTrip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();

  let allowed = !!ownedTrip;
  if (!allowed) {
    const { data: collab } = await supabase
      .from("trip_collaborators")
      .select("trip_id")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .maybeSingle();
    allowed = !!collab;
  }
  if (!allowed) return forbidden();

  // ---- Mint PKCE + state ----
  const pkce = createPkcePair();
  const state = signState({ userId: user.id, tripId });

  const authorizeUrl = buildAuthorizationUrl({
    config,
    state,
    codeChallenge: pkce.challenge,
    loginHint: user.email ?? undefined,
  });

  // ---- Set cookies + redirect ----
  // The verifier must NEVER leave the server — Google sees only the
  // challenge in the URL. We use httpOnly + SameSite=Lax so the
  // cookie survives Google's HTTPS top-level redirect back to us.
  // Secure in prod (Vercel always HTTPS); skipped on localhost so
  // dev works without HTTPS.
  const isProd = process.env.NODE_ENV === "production";
  const res = NextResponse.redirect(authorizeUrl, { status: 302 });

  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  };
  res.cookies.set(COOKIE_VERIFIER, pkce.verifier, cookieBase);
  res.cookies.set(COOKIE_STATE, state, cookieBase);

  return res;
}
