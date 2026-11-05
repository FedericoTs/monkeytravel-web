/**
 * POST /api/shared/[token]/today-action — the four in-trip chips (Phase 3.3)
 *
 * A live trip's owner or a participant taps Running late / Skip this / Swap
 * nearby / Done for today. The action is written to trip_today_actions and
 * overlaid on everyone's Today view in real time; it NEVER edits the owner's
 * itinerary (a participant is anonymous and cannot). A signed-in person acts
 * as their account, a guest as the shared mt_anon_voter cookie (lib/today/actor).
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
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { participantCookieId, readParticipantWrite, setParticipantCookie, signedInUser } from "@/lib/participants/request";
import { todayActionsSnapshot } from "@/lib/today/snapshot";
import { announceTodayChange, writeTodayAction, type TodayActionBody } from "@/lib/today/write";
import { readSharedTrip } from "@/lib/trips/shared-trip";

const ipLimiter = createRateLimiter("today-action-ip", 40, 60_000);
const cookieTripLimiter = createRateLimiter("today-action-cookie-trip", 20, 60_000);

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const write = await readParticipantWrite<TodayActionBody>(request, context, ipLimiter);
    if (write.errorResponse) return write.errorResponse;
    const { token, body, cookieStore, existingCookie } = write;

    const admin = createAdminClient();
    const { trip, errorResponse } = await readSharedTrip<{ id: string; user_id: string | null; trip_meta: unknown }>(
      admin,
      token,
      "id, user_id, trip_meta",
    );
    if (errorResponse) return errorResponse;

    const { cookieId, issued: issuedCookie } = participantCookieId(existingCookie);

    const { allowed: cookieAllowed } = await cookieTripLimiter.check(request, `${cookieId}:${trip.id}`);
    if (!cookieAllowed) return errors.rateLimit("Too many changes. Please slow down.");

    const user = await signedInUser();

    const failed = await writeTodayAction(admin, trip, { user, cookieId }, body);
    if (failed) return failed;
    announceTodayChange(admin, trip.id);
    if (issuedCookie) setParticipantCookie(cookieStore, cookieId);
    return apiSuccess(await todayActionsSnapshot(admin, trip.id, cookieId, user?.id ?? null));
  } catch (error) {
    console.error("[today-action] Unexpected error:", error);
    return errors.internal("Internal server error", "TodayAction");
  }
}
