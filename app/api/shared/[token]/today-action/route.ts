/**
 * POST /api/shared/[token]/today-action — the four in-trip chips (Phase 3.3)
 *
 * A live trip's owner or a participant taps Running late / Skip this / Swap
 * nearby / Done for today. The action is written to trip_today_actions and
 * overlaid on everyone's Today view in real time; it NEVER edits the owner's
 * itinerary (a participant is anonymous and cannot). Identity is the shared
 * mt_anon_voter cookie; the owner is resolved from their session.
 *
 * Body:
 *   { action_type: 'running_late'|'skip'|'swap'|'done',
 *     day_number: number, activity_id?: string,
 *     activity?: { name, type, location, address },  // for swap's AI call
 *     destination?: string, undo?: boolean, action_id?: string }
 *
 * A chip tap is idempotent (a partial unique index + ON CONFLICT DO NOTHING),
 * so a double-tap is one action. Undo is explicit: { undo: true, action_id }.
 * Returns the trip's active actions (same shape as GET) so the client can
 * replace its state in one go.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { captureServerEvent } from "@/lib/posthog/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE, PARTICIPANT_COOKIE_MAX_AGE_SECONDS, isUuid } from "@/lib/participants/shared";
import { parseTodayActionType, RUNNING_LATE_STEP_MINUTES } from "@/lib/today/actions";
import { todayActionsSnapshot } from "@/lib/today/snapshot";
import { suggestNearbyAlternative } from "@/lib/ai/nearby-alternative";

const ipLimiter = createRateLimiter("today-action-ip", 40, 60_000);
const cookieTripLimiter = createRateLimiter("today-action-cookie-trip", 20, 60_000);
const BOT_UA_REGEX = /^(curl|wget|python-requests|httpie|go-http-client|libwww-perl|scrapy)\b/i;

interface Body {
  action_type?: unknown;
  day_number?: unknown;
  activity_id?: unknown;
  activity?: { name?: unknown; type?: unknown; location?: unknown; address?: unknown };
  destination?: unknown;
  undo?: unknown;
  action_id?: unknown;
}

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { token } = await context.params;
    if (!token || !isUuid(token)) return errors.badRequest("Invalid share token");

    const { allowed: ipAllowed } = await ipLimiter.check(request);
    if (!ipAllowed) return errors.rateLimit("Too many requests. Please slow down.");

    const cookieStore = await cookies();
    const existingCookie = cookieStore.get(PARTICIPANT_COOKIE)?.value;
    if (!existingCookie) {
      const ua = request.headers.get("user-agent") ?? "";
      if (!ua || BOT_UA_REGEX.test(ua)) return errors.badRequest("Invalid request");
    }

    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object") return errors.badRequest("Invalid request body");

    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, user_id, trip_meta")
      .eq("share_token", token)
      .single();
    if (tripError || !trip) return errors.notFound("Shared trip not found");

    let cookieId = existingCookie;
    let issuedCookie = false;
    if (!cookieId || cookieId.length < 10 || cookieId.length > 60) {
      cookieId = nanoid(21);
      issuedCookie = true;
    }

    const { allowed: cookieAllowed } = await cookieTripLimiter.check(request, `${cookieId}:${trip.id}`);
    if (!cookieAllowed) return errors.rateLimit("Too many changes. Please slow down.");

    // Owner vs participant.
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }
    const isOwner = !!userId && userId === trip.user_id;

    const finish = async () => {
      if (issuedCookie) {
        cookieStore.set({
          name: PARTICIPANT_COOKIE,
          value: cookieId,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: PARTICIPANT_COOKIE_MAX_AGE_SECONDS,
          path: "/",
        });
      }
      return apiSuccess(await todayActionsSnapshot(admin, trip.id, cookieId, userId));
    };

    // ---- Undo: soft, and only your own action.
    if (body.undo === true) {
      const actionId = typeof body.action_id === "string" ? body.action_id : "";
      if (!actionId || !isUuid(actionId)) return errors.badRequest("Invalid action_id");
      const match = isOwner
        ? admin.from("trip_today_actions").update({ undone_at: new Date().toISOString() }).eq("id", actionId).eq("trip_id", trip.id)
        : admin
            .from("trip_today_actions")
            .update({ undone_at: new Date().toISOString() })
            .eq("id", actionId)
            .eq("trip_id", trip.id)
            .eq("actor_cookie_id", cookieId);
      const { error } = await match.is("undone_at", null);
      if (error) {
        console.error("[today-action] undo failed:", error);
        return errors.internal("Could not undo", "TodayAction");
      }
      return finish();
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

    // Attribution: the participant's name (Phase 2) or the owner.
    let actorName: string | null = null;
    if (isOwner) {
      actorName = null; // rendered as "The owner"
    } else {
      const { data: participant } = await admin
        .from("trip_participants")
        .select("display_name")
        .eq("trip_id", trip.id)
        .eq("participant_cookie_id", cookieId)
        .maybeSingle();
      actorName = (participant?.display_name as string | null) ?? null;
    }

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
      actor_cookie_id: isOwner ? null : cookieId,
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
      captureServerEvent(isOwner ? (userId as string) : cookieId, "today_action", {
        trip_id: trip.id,
        action_type: actionType,
        role: isOwner ? "owner" : "participant",
      });
    }

    return finish();
  } catch (error) {
    console.error("[today-action] Unexpected error:", error);
    return errors.internal("Internal server error", "TodayAction");
  }
}
