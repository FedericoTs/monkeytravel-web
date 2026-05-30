import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type {
  RegisterDeviceRequest,
  DevicePlatform,
} from "@/lib/push/types";

/**
 * POST /api/devices/register
 *
 * Called by the native client on every cold launch after we have both
 * (a) the user authenticated and (b) a push token from
 * @capacitor/push-notifications. Idempotent — re-running with the
 * same token refreshes last_seen_at + locale + app_version without
 * inserting a duplicate row.
 *
 * Implementation notes:
 *
 *   - Upsert via Supabase ON CONFLICT(token) DO UPDATE. token is the
 *     UNIQUE key per the migration. Same physical device that's been
 *     re-installed yields a new token from APNs/FCM — so we can't
 *     dedup on (user_id, platform). UNIQUE(token) is the source of
 *     truth.
 *
 *   - We trust auth.uid() from the session, NEVER the client. If two
 *     users somehow share a token row, the upsert reassigns user_id
 *     to whoever's session is active right now — that's the right
 *     behaviour for account-switch on a shared device.
 *
 *   - Validation is permissive on app_version + locale (just strings).
 *     Tight validation on platform (must be ios/android) and token
 *     (must be non-empty trimmed string). Anything else fails the
 *     request — silently swallowing bad client data means we'd ship
 *     dead rows and waste APNs/FCM quota chasing them.
 *
 *   - Suppressed_at is explicitly RESET to null on re-registration.
 *     A user re-installing the app and re-granting permission means
 *     we should start dispatching again, even if the prior install's
 *     token bounced.
 *
 * NOT IMPLEMENTED YET (planned for B1 follow-ups):
 *   - DELETE /api/devices/[token] endpoint for sign-out cleanup
 *   - Validation of token shape per platform (APNs is 64 hex chars,
 *     FCM is variable-length base64) — current TEXT NOT NULL is
 *     sufficient pre-fan-out; the dispatcher catches malformed
 *     tokens via the APNs/FCM error response anyway.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    let body: RegisterDeviceRequest;
    try {
      body = (await request.json()) as RegisterDeviceRequest;
    } catch {
      return errors.badRequest("Invalid JSON body");
    }

    // Tight platform validation — the dispatcher branches on this so
    // an unrecognized value would route nowhere and silently drop the
    // push. Fail loudly at write time instead.
    const platform = body.platform as DevicePlatform;
    if (platform !== "ios" && platform !== "android") {
      return errors.badRequest("platform must be 'ios' or 'android'");
    }

    // Token validation — non-empty string after trim. APNs tokens are
    // 64 hex chars; FCM tokens are ~150-200 base64 chars. We don't
    // enforce length here (provider format may change) but we do strip
    // whitespace because some Capacitor plugin versions append a
    // trailing newline.
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length < 32 || token.length > 512) {
      return errors.badRequest("token must be a 32-512 char string");
    }

    // Optional fields — keep loosely typed; bounded to prevent
    // unbounded string DOS via the token registration endpoint.
    const appVersion =
      typeof body.appVersion === "string"
        ? body.appVersion.slice(0, 32)
        : null;
    const locale =
      typeof body.locale === "string" ? body.locale.slice(0, 16) : null;

    const nowIso = new Date().toISOString();

    // Upsert. ON CONFLICT (token) updates everything except id +
    // created_at. suppressed_at explicitly reset because a re-register
    // signals the user gave permission again — even if the prior
    // dispatch had hit Unregistered/NotRegistered.
    const { data, error } = await supabase
      .from("device_tokens")
      .upsert(
        {
          user_id: user.id,
          token,
          platform,
          app_version: appVersion,
          locale,
          last_seen_at: nowIso,
          suppressed_at: null,
        },
        { onConflict: "token" }
      )
      .select("last_seen_at")
      .single();

    if (error) {
      console.error("[Device Register] upsert failed:", error);
      return errors.internal("Failed to register device", "Device Register");
    }

    return apiSuccess({
      ok: true,
      platform,
      lastSeenAt: data?.last_seen_at ?? nowIso,
    });
  } catch (error) {
    console.error("[Device Register] unexpected:", error);
    return errors.internal("Internal server error", "Device Register");
  }
}
