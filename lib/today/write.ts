import "server-only";
import { after, type NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/response-wrapper";
import { captureServerEvent } from "@/lib/posthog/server";
import { suggestNearbyAlternative } from "@/lib/ai/nearby-alternative";
import { isUuid } from "@/lib/participants/shared";
import { parseTodayActionType, RUNNING_LATE_STEP_MINUTES, TODAY_CHANGED_EVENT, TODAY_CHANNEL_OPTIONS, todayChannel } from "./actions";
import { isTodayActor, resolveTodayPerson, storedCookie } from "./actor";

/**
 * Applying and undoing a chip on a live trip's Today, shared by the
 * share-link route (/api/shared/[token]/today-action) and the members' route
 * (/api/trips/[id]/today/today-action). Each route finds the trip and the
 * person its own way; what happens to the tap is the same.
 */

export interface TodayActionBody {
  action_type?: unknown;
  day_number?: unknown;
  activity_id?: unknown;
  activity?: { name?: unknown; type?: unknown; location?: unknown; address?: unknown };
  destination?: unknown;
  undo?: unknown;
  action_id?: unknown;
}

export interface TodayRequester {
  user: { id: string; email?: string | null } | null;
  /** This browser's guest cookie, if it holds one. */
  cookieId: string | null;
}

/**
 * Everyone on this trip's Today re-fetches on this ping; it carries no data, so
 * the table needs no public read. Sent on the private channel, which only the
 * service role can send on.
 */
export function announceTodayChange(admin: SupabaseClient, tripId: string): void {
  after(() =>
    admin.channel(todayChannel(tripId), TODAY_CHANNEL_OPTIONS).httpSend(TODAY_CHANGED_EVENT, {}).then(() => undefined, () => undefined),
  );
}

/** Applies or undoes a chip. Returns the error to answer with, or null once the change is written. */
export async function writeTodayAction(
  admin: SupabaseClient,
  trip: { id: string; user_id: string | null; trip_meta?: unknown },
  requester: TodayRequester,
  body: TodayActionBody,
): Promise<NextResponse | null> {
  const { user, cookieId } = requester;
  const userId = user?.id ?? null;
  const isOwner = !!userId && userId === trip.user_id;
  const actor = { userId, cookieId };

  // ---- Undo: soft, and only your own action (the owner may undo any).
  if (body.undo === true) {
    const actionId = typeof body.action_id === "string" ? body.action_id : "";
    if (!actionId || !isUuid(actionId)) return errors.badRequest("Invalid action_id");
    const { data: row, error: readError } = await admin
      .from("trip_today_actions")
      .select("actor_user_id, actor_cookie_id")
      .eq("id", actionId)
      .eq("trip_id", trip.id)
      .is("undone_at", null)
      .maybeSingle();
    if (readError) {
      console.error("[today-action] undo read failed:", readError);
      return errors.internal("Could not undo", "TodayAction");
    }
    const by = { userId: (row?.actor_user_id as string | null) ?? null, cookieId: (row?.actor_cookie_id as string | null) ?? null };
    if (row && (isOwner || isTodayActor(actor, by))) {
      const { error } = await admin
        .from("trip_today_actions")
        .update({ undone_at: new Date().toISOString() })
        .eq("id", actionId)
        .is("undone_at", null);
      if (error) {
        console.error("[today-action] undo failed:", error);
        return errors.internal("Could not undo", "TodayAction");
      }
    }
    return null;
  }

  // ---- Apply a chip.
  const actionType = parseTodayActionType(body.action_type);
  if (!actionType) return errors.badRequest("Invalid action_type");
  const dayNumber = typeof body.day_number === "number" && Number.isFinite(body.day_number) ? Math.max(1, Math.floor(body.day_number)) : 0;
  if (!dayNumber) return errors.badRequest("Invalid day_number");
  const activityId =
    typeof body.activity_id === "string" && body.activity_id.length > 0 && body.activity_id.length <= 100 ? body.activity_id : null;
  if ((actionType === "skip" || actionType === "swap") && !activityId) {
    return errors.badRequest(`${actionType} needs an activity_id`);
  }

  const { name: actorName } = await resolveTodayPerson(admin, trip, user, cookieId);

  const payload: Record<string, unknown> = {};
  if (actionType === "running_late") payload.minutes = RUNNING_LATE_STEP_MINUTES;
  if (actionType === "swap") {
    const meta = (trip.trip_meta ?? {}) as { destination?: string; locale?: string };
    const destination = (typeof body.destination === "string" && body.destination) || meta.destination || "the area";
    const a = body.activity ?? {};
    const suggestion = await suggestNearbyAlternative(
      {
        name: typeof a.name === "string" ? a.name : "this activity",
        type: typeof a.type === "string" ? a.type : "",
        location: typeof a.location === "string" ? a.location : "",
        address: typeof a.address === "string" ? a.address : "",
      },
      destination,
      meta.locale || "en",
    );
    if (!suggestion) return errors.internal("Could not find an alternative right now", "TodayAction");
    payload.swap_to = suggestion;
  }

  const { error: insertError } = await admin.from("trip_today_actions").insert({
    trip_id: trip.id,
    day_number: dayNumber,
    action_type: actionType,
    activity_id: activityId,
    payload,
    actor_cookie_id: storedCookie(actor),
    actor_user_id: userId,
    actor_name: actorName,
    actor_role: isOwner ? "owner" : "participant",
  });
  // A double-tap collides with the partial unique index — that is the
  // idempotency guarantee, not an error.
  if (insertError && insertError.code !== "23505") {
    console.error("[today-action] insert failed:", insertError);
    return errors.internal("Could not save that", "TodayAction");
  }
  if (!insertError) {
    captureServerEvent(userId ?? cookieId ?? "anon", "today_action", {
      trip_id: trip.id,
      action_type: actionType,
      role: isOwner ? "owner" : "participant",
    });
  }
  return null;
}
