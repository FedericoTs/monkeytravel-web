import { NextRequest, NextResponse } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyUnsubscribeToken,
  verifyParticipantUnsubscribeToken,
  unsubKeyToSettingPatch,
  type UnsubKey,
} from "@/lib/email/unsubscribe";
import { stopGuestDigest } from "@/lib/participants/digest-unsubscribe";

/**
 * Headers required to keep email-scanner / link-prefetcher caches from
 * (a) caching a response and (b) ever treating a GET as an action. Per
 * RFC 8058 the only side-effecting unsubscribe is POST with the
 * List-Unsubscribe-Post header.
 */
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

/**
 * Apply the unsubscribe mutation. Idempotent — calling twice flips the
 * same key off twice (still false). Returns whether a profile row
 * existed; never leaks user existence to the caller.
 */
async function applyUnsubscribe(
  userId: string,
  key: UnsubKey
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data: profile, error: readErr } = await admin
    .from("users")
    .select("id, notification_settings")
    .eq("id", userId)
    .maybeSingle();
  if (readErr || !profile) {
    return { applied: false };
  }

  const current = (profile.notification_settings ?? {}) as Record<
    string,
    unknown
  >;
  const patch = unsubKeyToSettingPatch(key);
  const next = { ...current, ...patch };

  const { error: writeErr } = await admin
    .from("users")
    .update({
      notification_settings: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  if (writeErr) {
    console.error("[unsubscribe] write failed:", writeErr.message);
    throw new Error("Failed to update preferences");
  }

  return { applied: true };
}

/**
 * What a token stops, and how: a guest's token one trip's daily plan
 * (lib/participants/digest-unsubscribe.ts), an account's token one kind of
 * email. `info` is what a response may say about it.
 */
function readToken(token: string):
  | { ok: true; info: Record<string, unknown>; apply: () => Promise<{ applied: boolean }> }
  | { ok: false; reason: string } {
  const guest = verifyParticipantUnsubscribeToken(token);
  if (guest.ok && guest.participantId) {
    const participantId = guest.participantId;
    return { ok: true, info: { guest: true }, apply: () => stopGuestDigest(createAdminClient(), participantId) };
  }
  // An expired guest token says so, rather than failing as an account token.
  if (guest.reason === "expired") return { ok: false, reason: "expired" };
  const result = verifyUnsubscribeToken(token);
  if (!result.ok || !result.payload) return { ok: false, reason: result.reason ?? "format" };
  const { u, k } = result.payload;
  return { ok: true, info: { key: k }, apply: () => applyUnsubscribe(u, k) };
}

/**
 * POST /api/unsubscribe
 * Body: { token: string }, or the token in the URL (a mail client's one-click
 * POST, which middleware.ts routes here from the /unsubscribe page's URL)
 *
 * RFC 8058-style one-click unsubscribe. Verifies the HMAC token, flips
 * the user's notification_settings, returns 200. Mail clients
 * (Gmail/Yahoo Postmaster) hit this in response to the
 * List-Unsubscribe-Post header. Browser flow: the /unsubscribe page's
 * "Confirm" button POSTs here when the user actually clicks it.
 *
 * This is the ONLY surface that mutates. GET is intentionally read-only
 * so link prefetchers (Gmail proxy, Outlook Safe Links, Bitdefender,
 * Slack unfurlers etc.) can never silently opt a user out by merely
 * scanning a link.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    // RFC 8058 posts the form "List-Unsubscribe=One-Click": the token is in the URL.
    const token =
      typeof body?.token === "string"
        ? body.token
        : request.nextUrl.searchParams.get("token") || "";

    const target = readToken(token);
    if (!target.ok) {
      return errors.badRequest(`Invalid token: ${target.reason}`);
    }

    const { applied } = await target.apply();

    return apiSuccess({ ok: true, applied, ...target.info });
  } catch (err) {
    return errors.internal(
      err instanceof Error ? err.message : "Unsubscribe failed",
      "Unsubscribe"
    );
  }
}

/**
 * GET /api/unsubscribe?token=...
 *
 * READ-ONLY. Verifies the token and returns the targeted preference key
 * so the confirmation page can render a clear "you're about to unsubscribe
 * from X" prompt. Does NOT mutate — the user must POST (via the page's
 * Confirm button, or via the mail-client one-click POST) for the
 * preference flip to apply.
 *
 * Legacy escape hatch: `?confirm=1` may be appended to apply the
 * mutation on GET, for the (vanishingly rare) very old mail client that
 * cannot POST one-click. The bare GET (which is what every email
 * scanner does) is always read-only.
 *
 * `Cache-Control: no-store` blocks scanner proxies (Gmail image cache,
 * Outlook Safe Links) from holding onto the response.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const confirm = request.nextUrl.searchParams.get("confirm") === "1";

  const target = readToken(token);
  if (!target.ok) {
    // Attach no-store even on error so scanners don't cache 400s.
    const res = errors.badRequest(`Invalid token: ${target.reason}`);
    res.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
    return res;
  }

  // Legacy GET-with-confirm path: explicit opt-in to mutation. Not used
  // by mail scanners (they don't know the magic flag) so this is safe.
  if (confirm) {
    try {
      const { applied } = await target.apply();
      return apiSuccess(
        { ok: true, applied, ...target.info },
        { headers: { ...NO_STORE_HEADERS } }
      );
    } catch (err) {
      const res = errors.internal(
        err instanceof Error ? err.message : "Unsubscribe failed",
        "Unsubscribe"
      );
      res.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return res;
    }
  }

  // Default GET: read-only token preview. The confirmation page calls
  // this to decide what label to show before the user clicks Confirm.
  return apiSuccess(
    {
      ok: true,
      applied: false,
      ...target.info,
      // Note: we deliberately do NOT include user_id or email in the
      // response — the token already proves the holder controls the
      // unsubscribe, and we don't want a token leak to also leak PII.
    },
    { headers: { ...NO_STORE_HEADERS } }
  );
}

/**
 * Used by Next.js to advertise HEAD support — same as GET but without
 * a body. Some scanners HEAD before GET; we want this to be a cheap
 * no-op rather than a JSON error.
 */
export async function HEAD(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const status = readToken(token).ok ? 200 : 400;
  return new NextResponse(null, {
    status,
    headers: NO_STORE_HEADERS,
  });
}
