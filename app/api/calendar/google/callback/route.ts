/**
 * GET /api/calendar/google/callback?code=…&state=…
 *
 * Phase 2 of calendar-export. Google redirects the user back here
 * after they consent. We:
 *
 *   1. Re-check feature flag + env (defence in depth — connect/ may
 *      have flipped between request start and callback).
 *   2. Re-authenticate via Supabase session.
 *   3. Verify the OAuth `state` HMAC AND that the session user
 *      matches the userId baked into the state. Closes the
 *      cross-account replay window.
 *   4. Cross-check `state` against the httpOnly cookie set by
 *      /connect — defends against the "attacker tricks victim
 *      into hitting /callback with a state attacker minted"
 *      scenario.
 *   5. Pull the PKCE verifier from its cookie + exchange the code
 *      for tokens.
 *   6. Encrypt + upsert tokens into user_calendar_connections.
 *   7. Fetch the trip + run syncTripToGoogle.
 *   8. Record the sync in trip_calendar_syncs (so the toast on
 *      the trip page knows how many events landed).
 *   9. Redirect to /<locale>/trips/<id>?gcal_sync=done — the
 *      TripDetailClient picks up the param and fires a toast,
 *      then strips it from the URL.
 *
 * Failure handling
 * ----------------
 * - Google sent `error` instead of `code` (user denied consent) →
 *   redirect to trip page with ?gcal_sync=denied. UI shows a
 *   gentler toast.
 * - Token exchange failed (network, code expired) → redirect with
 *   ?gcal_sync=error&reason=exchange.
 * - Sync partial / failed → still record + still redirect to the
 *   trip page with ?gcal_sync=partial — events that did make it
 *   are visible immediately in the user's calendar.
 *
 * We DELIBERATELY do not surface raw upstream errors to the URL —
 * they go to Sentry and the database column instead. Public URL
 * carries only enum statuses the client maps to copy.
 *
 * Runtime: nodejs.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForTokens,
  getGoogleOAuthConfig,
  isOAuthStateSecretConfigured,
  verifyState,
} from "@/lib/calendar/google-oauth";
import {
  encryptToken,
  isTokenEncryptionConfigured,
} from "@/lib/calendar/token-encryption";
import { syncTripToGoogle } from "@/lib/calendar/google-sync";
import type { FeedTrip } from "@/lib/calendar/feed";
import { isSafeNext } from "@/lib/security/safe-next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_STATE = "mt_gcal_oauth_state";
const COOKIE_VERIFIER = "mt_gcal_oauth_verifier";

/** Valid locales for the post-callback redirect. Must mirror i18n config. */
const KNOWN_LOCALES = new Set(["en", "es", "it"]);
const DEFAULT_LOCALE = "en";

type SyncStatusQuery = "done" | "partial" | "failed" | "denied" | "error";

function buildTripUrl(opts: {
  origin: string;
  locale: string;
  tripId: string;
  status: SyncStatusQuery;
  eventCount?: number;
  reason?: string;
}): string {
  const locale = KNOWN_LOCALES.has(opts.locale) ? opts.locale : DEFAULT_LOCALE;
  const path = `/${locale}/trips/${opts.tripId}`;
  // Defence in depth — guarantee we never construct an open-redirect
  // even though we just built the path ourselves.
  if (!isSafeNext(path)) {
    throw new Error("Built unsafe trip redirect path");
  }
  const params = new URLSearchParams({ gcal_sync: opts.status });
  if (typeof opts.eventCount === "number") {
    params.set("gcal_count", String(opts.eventCount));
  }
  if (opts.reason) {
    params.set("gcal_reason", opts.reason);
  }
  return `${opts.origin}${path}?${params.toString()}`;
}

function clearOauthCookies(res: NextResponse) {
  // Always wipe the OAuth state cookies after callback — they're
  // single-use by design.
  res.cookies.set(COOKIE_STATE, "", { maxAge: 0, path: "/" });
  res.cookies.set(COOKIE_VERIFIER, "", { maxAge: 0, path: "/" });
}

/**
 * Best-effort locale extraction from `Referer` so we can land the
 * user back on the right /it /es page. Falls back to default locale.
 */
function inferLocaleFromReferer(referer: string | null): string {
  if (!referer) return DEFAULT_LOCALE;
  try {
    const url = new URL(referer);
    const seg = url.pathname.split("/").filter(Boolean)[0];
    if (seg && KNOWN_LOCALES.has(seg)) return seg;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export async function GET(request: NextRequest) {
  const featureEnabled =
    process.env.NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED === "true";
  if (!featureEnabled) {
    return new NextResponse(null, { status: 404 });
  }

  const config = getGoogleOAuthConfig();
  const stateSecretOk = isOAuthStateSecretConfigured();
  const encOk = isTokenEncryptionConfigured();
  if (!config || !stateSecretOk || !encOk) {
    // Same 503 shape as /connect — operator visibility, not user
    // visibility.
    return NextResponse.json(
      { error: "Calendar sync not configured" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  // ---- Verify state EARLY so we can pull tripId for the redirect ----
  const stateResult = verifyState(stateParam);
  if (!stateResult.ok) {
    // We have no tripId — bounce to /trips with a generic error toast.
    const res = NextResponse.redirect(`${origin}/trips?gcal_sync=error&gcal_reason=${stateResult.reason}`);
    clearOauthCookies(res);
    return res;
  }
  const { userId: stateUserId, tripId } = stateResult.payload;

  // ---- Session check + user match ----
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const locale = inferLocaleFromReferer(request.headers.get("referer"));

  if (authError || !user) {
    // User got logged out mid-flow. Send them to login with a return
    // target — keeping the trip context is more important than the
    // partial OAuth flow.
    const res = NextResponse.redirect(
      `${origin}/auth/login?next=${encodeURIComponent(`/${locale}/trips/${tripId}`)}`
    );
    clearOauthCookies(res);
    return res;
  }

  // CRITICAL: state's userId must match the session user. Closes
  // the "attacker starts flow → victim completes it" replay window.
  if (user.id !== stateUserId) {
    const res = NextResponse.redirect(
      buildTripUrl({
        origin,
        locale,
        tripId,
        status: "error",
        reason: "user_mismatch",
      })
    );
    clearOauthCookies(res);
    return res;
  }

  // ---- Cookie state cross-check ----
  const cookieState = request.cookies.get(COOKIE_STATE)?.value;
  const codeVerifier = request.cookies.get(COOKIE_VERIFIER)?.value;
  if (!cookieState || cookieState !== stateParam) {
    const res = NextResponse.redirect(
      buildTripUrl({
        origin,
        locale,
        tripId,
        status: "error",
        reason: "state_mismatch",
      })
    );
    clearOauthCookies(res);
    return res;
  }
  if (!codeVerifier) {
    const res = NextResponse.redirect(
      buildTripUrl({
        origin,
        locale,
        tripId,
        status: "error",
        reason: "verifier_missing",
      })
    );
    clearOauthCookies(res);
    return res;
  }

  // ---- User denied or Google returned an error ----
  if (googleError || !code) {
    const status: SyncStatusQuery =
      googleError === "access_denied" ? "denied" : "error";
    const res = NextResponse.redirect(
      buildTripUrl({
        origin,
        locale,
        tripId,
        status,
        reason: googleError ?? "no_code",
      })
    );
    clearOauthCookies(res);
    return res;
  }

  // ---- Exchange code for tokens ----
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      config,
      code,
      codeVerifier,
    });
  } catch (err) {
    console.error("[gcal-callback] Token exchange failed:", err);
    const res = NextResponse.redirect(
      buildTripUrl({
        origin,
        locale,
        tripId,
        status: "error",
        reason: "exchange",
      })
    );
    clearOauthCookies(res);
    return res;
  }

  // ---- Persist encrypted tokens (admin client, bypasses RLS) ----
  const admin = createAdminClient();
  try {
    const accessEnc = encryptToken(tokens.access_token);
    const refreshEnc = encryptToken(tokens.refresh_token);
    const { error: connErr } = await admin
      .from("user_calendar_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "google",
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc,
          scope: tokens.scope,
          expires_at: tokens.expires_at,
          google_email: tokens.email ?? null,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (connErr) {
      throw new Error(`upsert user_calendar_connections: ${connErr.message}`);
    }
  } catch (err) {
    console.error("[gcal-callback] Persist tokens failed:", err);
    const res = NextResponse.redirect(
      buildTripUrl({
        origin,
        locale,
        tripId,
        status: "error",
        reason: "persist",
      })
    );
    clearOauthCookies(res);
    return res;
  }

  // ---- Fetch the trip (admin — we already verified ownership at
  //      /connect AND state binds tripId to userId). ----
  let trip: FeedTrip | null = null;
  {
    const { data, error: tripErr } = await admin
      .from("trips")
      .select("id, title, start_date, end_date, itinerary, trip_meta")
      .eq("id", tripId)
      .maybeSingle();
    if (tripErr || !data) {
      console.error("[gcal-callback] Fetch trip failed:", tripErr);
      const res = NextResponse.redirect(
        buildTripUrl({
          origin,
          locale,
          tripId,
          status: "error",
          reason: "trip_missing",
        })
      );
      clearOauthCookies(res);
      return res;
    }
    trip = data as FeedTrip;
  }

  // Defence in depth: re-verify ownership/collaborator membership
  // here too. /connect did the same check, but a malicious actor
  // who reused a stolen state shouldn't be able to push to a trip
  // they've since been kicked off of.
  {
    const owns = await admin
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .maybeSingle();
    let allowed = !!owns.data;
    if (!allowed) {
      const collab = await admin
        .from("trip_collaborators")
        .select("trip_id")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .maybeSingle();
      allowed = !!collab.data;
    }
    if (!allowed) {
      const res = NextResponse.redirect(
        buildTripUrl({
          origin,
          locale,
          tripId,
          status: "error",
          reason: "forbidden",
        })
      );
      clearOauthCookies(res);
      return res;
    }
  }

  // ---- Sync to Google ----
  let syncResult;
  try {
    syncResult = await syncTripToGoogle({
      trip,
      accessToken: tokens.access_token,
    });
  } catch (err) {
    console.error("[gcal-callback] Sync threw:", err);
    syncResult = {
      status: "failed" as const,
      eventCount: 0,
      attemptedCount: 0,
      lastError: err instanceof Error ? err.message.slice(0, 200) : String(err),
      calendarId: "primary",
    };
  }

  // ---- Record the sync (best effort — even a failed sync row is
  //      useful diagnostic data). ----
  try {
    const { error: syncErr } = await admin
      .from("trip_calendar_syncs")
      .upsert(
        {
          trip_id: tripId,
          user_id: user.id,
          provider: "google",
          external_calendar_id: syncResult.calendarId,
          event_count: syncResult.eventCount,
          status: syncResult.status,
          last_error: syncResult.lastError ?? null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "trip_id,provider,user_id" }
      );
    if (syncErr) {
      console.error("[gcal-callback] Record sync failed:", syncErr);
    }
  } catch (err) {
    console.error("[gcal-callback] Record sync threw:", err);
  }

  // Also update the connection's last_synced_at + clear last_sync_error
  // (best effort).
  try {
    await admin
      .from("user_calendar_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error:
          syncResult.status === "failed" ? syncResult.lastError ?? null : null,
      })
      .eq("user_id", user.id);
  } catch (err) {
    console.error("[gcal-callback] Update connection meta failed:", err);
  }

  // ---- Redirect to trip page with status ----
  const status: SyncStatusQuery =
    syncResult.status === "ok"
      ? "done"
      : syncResult.status === "partial"
      ? "partial"
      : "failed";

  const res = NextResponse.redirect(
    buildTripUrl({
      origin,
      locale,
      tripId,
      status,
      eventCount: syncResult.eventCount,
    })
  );
  clearOauthCookies(res);
  return res;
}
