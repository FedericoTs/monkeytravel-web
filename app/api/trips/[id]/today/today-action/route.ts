/**
 * POST /api/trips/[id]/today/today-action — a member's chip tap on Today.
 *
 * The members' mirror of /api/shared/[token]/today-action: the owner and
 * collaborators act from the trip page, signed in, whether or not the trip
 * has a share link. Same body and response; the tap itself is
 * lib/today/write.
 */
import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { TripRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { browserGuestCookie } from "@/lib/today/actor";
import { todayActionsSnapshot } from "@/lib/today/snapshot";
import { announceTodayChange, writeTodayAction, type TodayActionBody } from "@/lib/today/write";

const memberTripLimiter = createRateLimiter("today-action-member-trip", 20, 60_000);

export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { allowed } = await memberTripLimiter.check(request, `${user.id}:${id}`);
    if (!allowed) return errors.rateLimit("Too many changes. Please slow down.");

    const { trip, errorResponse: accessError } = await verifyTripAccess(supabase, id, user.id, "id, user_id, trip_meta");
    if (accessError) return accessError;

    const body = (await request.json().catch(() => null)) as TodayActionBody | null;
    if (!body || typeof body !== "object") return errors.badRequest("Invalid request body");

    const admin = createAdminClient();
    const cookieId = await browserGuestCookie();
    const failed = await writeTodayAction(admin, trip, { user, cookieId }, body);
    if (failed) return failed;
    announceTodayChange(admin, trip.id);
    return apiSuccess(await todayActionsSnapshot(admin, trip.id, cookieId ?? undefined, user.id));
  } catch (error) {
    console.error("[today-action member] Unexpected error:", error);
    return errors.internal("Internal server error", "TodayAction");
  }
}
