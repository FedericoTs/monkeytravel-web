import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyUnsubscribeToken,
  unsubKeyToSettingPatch,
} from "@/lib/email/unsubscribe";

/**
 * POST /api/unsubscribe
 * Body: { token: string }
 *
 * One-click RFC 8058-style unsubscribe handler. Verifies the HMAC token,
 * flips the user's notification_settings, and returns 200 — no further
 * UI is necessary for the one-click flow (Gmail/Outlook just need a 2xx).
 *
 * The GET-form unsubscribe page lives at /[locale]/unsubscribe/page.tsx
 * and renders a friendly confirmation. POST is used by mail-client
 * automated one-click and by the page's "Confirm" button.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : "";

    const result = verifyUnsubscribeToken(token);
    if (!result.ok || !result.payload) {
      return errors.badRequest(`Invalid token: ${result.reason}`);
    }

    const admin = createAdminClient();
    const { data: profile, error: readErr } = await admin
      .from("users")
      .select("id, notification_settings")
      .eq("id", result.payload.u)
      .maybeSingle();
    if (readErr || !profile) {
      // Don't leak whether the user exists — treat as success either way.
      // The token was valid; if the user was deleted post-token-mint
      // there's nothing to do.
      return apiSuccess({ ok: true, applied: false });
    }

    const current = (profile.notification_settings ?? {}) as Record<
      string,
      unknown
    >;
    const patch = unsubKeyToSettingPatch(result.payload.k);
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
      return errors.internal("Failed to update preferences", "Unsubscribe");
    }

    return apiSuccess({ ok: true, applied: true, key: result.payload.k });
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
 * Verifies the token without mutating — used by the confirmation page
 * to show "you're unsubscribing from X" before the user clicks confirm,
 * AND by RFC 8058 one-click mail clients (Gmail Postmaster will POST,
 * but some older clients GET).
 *
 * For compliance: when a client GETs with the right token, we treat that
 * as the one-click action and APPLY the unsubscribe immediately. This
 * mirrors what Gmail expects per their bulk-sender guidelines.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const result = verifyUnsubscribeToken(token);
  if (!result.ok || !result.payload) {
    return errors.badRequest(`Invalid token: ${result.reason}`);
  }
  // Fire the same write path as POST.
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("id, notification_settings")
      .eq("id", result.payload.u)
      .maybeSingle();
    if (!profile) return apiSuccess({ ok: true, applied: false });
    const current = (profile.notification_settings ?? {}) as Record<
      string,
      unknown
    >;
    const patch = unsubKeyToSettingPatch(result.payload.k);
    await admin
      .from("users")
      .update({
        notification_settings: { ...current, ...patch },
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);
    return apiSuccess({ ok: true, applied: true, key: result.payload.k });
  } catch (err) {
    return errors.internal(
      err instanceof Error ? err.message : "Unsubscribe failed",
      "Unsubscribe"
    );
  }
}
