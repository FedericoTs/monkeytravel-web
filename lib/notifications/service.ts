/**
 * Server-only notification service.
 *
 * Two entry points:
 *   - enqueueNotification(): writes a row to `notifications`. Called from
 *     API routes that detect events (vote cast, proposal created, etc.).
 *     Always uses the service-role client because the table's RLS forbids
 *     client-side inserts (anyone can't fabricate a notification for
 *     someone else).
 *   - listNotifications(): user-scoped read used by the bell dropdown.
 *
 * Failure mode: enqueue is best-effort. If the insert fails we log + swallow
 * so the originating API request doesn't 500. A missed bell ping is a
 * worse-than-zero outcome but it's strictly better than failing the vote.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  NotificationPayload,
  NotificationRow,
  NotificationType,
} from "./types";

interface EnqueueArgs {
  userId: string;
  notification: NotificationPayload;
}

/**
 * Insert a notification for `userId`. Always succeeds from the caller's
 * perspective — internal errors are logged and swallowed so we never break
 * the originating user action (e.g. a vote should not 500 because a bell
 * ping failed).
 */
export async function enqueueNotification({
  userId,
  notification,
}: EnqueueArgs): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      type: notification.type,
      payload: notification.data,
    });
    if (error) {
      console.error("[notifications] enqueue failed", {
        userId,
        type: notification.type,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("[notifications] enqueue exception", {
      userId,
      type: notification.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface ListOptions {
  /** Include rows the user has marked read. Default false (unread only). */
  includeRead?: boolean;
  /** Max rows. Default 20, max 100. */
  limit?: number;
}

interface ListResult {
  notifications: NotificationRow[];
  unreadCount: number;
}

/**
 * List the calling user's notifications + their unread count. Returns the
 * empty list (not an error) for anonymous callers — keeps the bell UI
 * trivial on the client side.
 */
export async function listNotifications(
  options: ListOptions = {}
): Promise<ListResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { notifications: [], unreadCount: 0 };
  }

  const limit = Math.min(100, Math.max(1, options.limit ?? 20));

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!options.includeRead) {
    query = query.is("read_at", null);
  }

  const [{ data: rows, error }, { count: unreadCount, error: countErr }] =
    await Promise.all([
      query,
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .is("read_at", null),
    ]);

  if (error || countErr) {
    console.error("[notifications] list failed", {
      userId: user.id,
      error: error?.message ?? countErr?.message,
    });
    return { notifications: [], unreadCount: 0 };
  }

  return {
    notifications: (rows ?? []) as NotificationRow[],
    unreadCount: unreadCount ?? 0,
  };
}

/**
 * Mark a single notification read. RLS ensures the row must belong to the
 * calling user.
 */
export async function markRead(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[notifications] markRead failed", id, error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Mark every unread notification for the calling user as read in one shot
 * — used by the "Mark all read" button at the top of the dropdown.
 */
export async function markAllRead(): Promise<{ ok: boolean; updated: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, updated: 0 };

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("user_id", user.id)
    .is("read_at", null)
    .select("id");

  if (error) {
    console.error("[notifications] markAllRead failed", error.message);
    return { ok: false, updated: 0 };
  }
  return { ok: true, updated: data?.length ?? 0 };
}

/**
 * Re-export the type names for callers that only need the discriminator
 * without pulling in the full payload union.
 */
export type { NotificationType };
