import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TodayAction } from "./actions";

/**
 * Active today-actions for a trip, shaped for the client (no cookie ids) with
 * `mine` set for the current viewer. Service-role read behind the /shared
 * route's token check. Live Trip Phase 3.3.
 */
export async function todayActionsSnapshot(
  admin: SupabaseClient,
  tripId: string,
  viewerCookieId: string | undefined,
  viewerUserId: string | null,
): Promise<TodayAction[]> {
  const { data, error } = await admin
    .from("trip_today_actions")
    .select("id, day_number, action_type, activity_id, payload, actor_name, actor_role, actor_cookie_id, actor_user_id, created_at, undone_at")
    .eq("trip_id", tripId)
    .is("undone_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[today-actions] snapshot read failed:", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    day_number: r.day_number as number,
    action_type: r.action_type as TodayAction["action_type"],
    activity_id: (r.activity_id as string | null) ?? null,
    payload: (r.payload as TodayAction["payload"]) ?? {},
    actor_name: (r.actor_name as string | null) ?? null,
    actor_role: r.actor_role as TodayAction["actor_role"],
    mine:
      (!!viewerCookieId && r.actor_cookie_id === viewerCookieId) ||
      (!!viewerUserId && r.actor_user_id === viewerUserId),
    created_at: r.created_at as string,
    undone_at: (r.undone_at as string | null) ?? null,
  }));
}
