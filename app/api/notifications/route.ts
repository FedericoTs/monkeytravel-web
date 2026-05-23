import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { listNotifications, markAllRead } from "@/lib/notifications/service";

/**
 * GET /api/notifications?includeRead=1&limit=20
 *
 * Returns the calling user's notifications + unread count. Anonymous
 * callers get `{ notifications: [], unreadCount: 0 }` and a 200 so the
 * bell UI can mount unconditionally without auth-state branching at the
 * component level.
 */
export async function GET(request: NextRequest) {
  try {
    const includeRead = request.nextUrl.searchParams.get("includeRead") === "1";
    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

    const result = await listNotifications({ includeRead, limit });
    return apiSuccess(result);
  } catch (err) {
    return errors.internal(
      err instanceof Error ? err.message : "Failed to load notifications",
      "Notifications"
    );
  }
}

/**
 * POST /api/notifications  (action=mark_all_read)
 *
 * Single endpoint for the "Mark all read" button. Returns `{ updated: N }`.
 * 401 for anonymous callers (this is a state mutation, not a read).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "mark_all_read") {
      return errors.badRequest('Unknown action. Try {"action":"mark_all_read"}.');
    }
    const result = await markAllRead();
    if (!result.ok) return errors.unauthorized("Sign in to manage notifications");
    return apiSuccess(result);
  } catch (err) {
    return errors.internal(
      err instanceof Error ? err.message : "Failed",
      "Notifications"
    );
  }
}
