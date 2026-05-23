import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { markRead } from "@/lib/notifications/service";

/**
 * PATCH /api/notifications/[id]  (currently only supports {action:"mark_read"})
 *
 * Marks a single notification as read. RLS in the DB enforces ownership
 * — we never need to re-check here. Returns 200 even if the id doesn't
 * belong to the caller (don't leak existence).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return errors.badRequest("Missing id");

    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "mark_read";

    if (action !== "mark_read") {
      return errors.badRequest('Unsupported action. Try {"action":"mark_read"}.');
    }

    const result = await markRead(id);
    if (!result.ok) return errors.unauthorized("Sign in to manage notifications");
    return apiSuccess({ ok: true });
  } catch (err) {
    return errors.internal(
      err instanceof Error ? err.message : "Failed",
      "Notifications"
    );
  }
}
