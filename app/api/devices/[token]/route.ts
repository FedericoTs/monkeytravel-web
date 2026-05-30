import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * DELETE /api/devices/[token]
 *
 * Sign-out cleanup. The native client calls this from its sign-out
 * flow right before clearing the Supabase session — once the session
 * is gone, the user's auth.uid() is gone and the RLS DELETE policy
 * would reject the request.
 *
 * Why this matters:
 *   Without explicit cleanup, the next person who signs in on the
 *   same device gets pushes intended for the previous user (APNs/FCM
 *   tokens stay valid until the OS revokes them, which can take
 *   weeks). That's a privacy + UX hazard — explicit DELETE on sign-out
 *   is the right way to handle multi-user devices.
 *
 * Idempotent: deleting a token that doesn't exist returns ok:true.
 * The client shouldn't have to remember whether it ever registered.
 *
 * Note: this only deletes the row for the authenticated user.
 * Supabase RLS (the `users delete own device_tokens` policy from the
 * migration) ensures we can't delete tokens belonging to other users
 * even if the client forges the token in the URL.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { token } = await context.params;
    if (!token || typeof token !== "string") {
      return errors.badRequest("token path param required");
    }

    // RLS scopes the DELETE to user_id = auth.uid() — we don't need
    // to add it to the where clause manually. Defense-in-depth: we
    // include user_id anyway so a future RLS misconfiguration can't
    // accidentally let signed-in user A delete signed-in user B's
    // token by guessing its value.
    const { error } = await supabase
      .from("device_tokens")
      .delete()
      .eq("token", token)
      .eq("user_id", user.id);

    if (error) {
      console.error("[Device Unregister] delete failed:", error);
      return errors.internal("Failed to unregister device", "Device Unregister");
    }

    // Idempotent — we don't care whether the row existed.
    return apiSuccess({ ok: true });
  } catch (error) {
    console.error("[Device Unregister] unexpected:", error);
    return errors.internal("Internal server error", "Device Unregister");
  }
}
