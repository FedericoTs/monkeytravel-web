import { NextRequest, NextResponse } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyUnsubscribeToken,
  unsubKeyToSettingPatch,
  type UnsubKey,
} from "@/lib/email/unsubscribe";

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
 * POST /api/unsubscribe
 * Body: { token: string }
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
    const token = typeof body?.token === "string" ? body.token : "";

    const result = verifyUnsubscribeToken(token);
    if (!result.ok || !result.payload) {
      return errors.badRequest(`Invalid token: ${result.reason}`);
    }

    const { applied } = await applyUnsubscribe(
      result.payload.u,
      result.payload.k
    );

    return apiSuccess({ ok: true, applied, key: result.payload.k });
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

  const result = verifyUnsubscribeToken(token);
  if (!result.ok || !result.payload) {
    // Attach no-store even on error so scanners don't cache 400s.
    const res = errors.badRequest(`Invalid token: ${result.reason}`);
    res.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
    return res;
  }

  // Legacy GET-with-confirm path: explicit opt-in to mutation. Not used
  // by mail scanners (they don't know the magic flag) so this is safe.
  if (confirm) {
    try {
      const { applied } = await applyUnsubscribe(
        result.payload.u,
        result.payload.k
      );
      return apiSuccess(
        { ok: true, applied, key: result.payload.k },
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
      key: result.payload.k,
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
  const result = verifyUnsubscribeToken(token);
  const status = result.ok ? 200 : 400;
  return new NextResponse(null, {
    status,
    headers: NO_STORE_HEADERS,
  });
}
