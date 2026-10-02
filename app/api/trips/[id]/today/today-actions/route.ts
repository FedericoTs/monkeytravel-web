/**
 * GET /api/trips/[id]/today/today-actions — the chip overlay, for members.
 *
 * The members' mirror of /api/shared/[token]/today-actions: the owner and
 * collaborators read Today on the trip page, signed in, whether or not the
 * trip has a share link. Same response.
 */
import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { browserGuestCookie } from "@/lib/today/actor";
import { allowTodayRead } from "@/lib/today/read-limit";
import { todayActionsSnapshot } from "@/lib/today/snapshot";

export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;
    if (!(await allowTodayRead(request, id, user.id))) return errors.rateLimit("Too many requests. Please slow down.");
    const { trip, errorResponse: accessError } = await verifyTripAccess(supabase, id, user.id);
    if (accessError) return accessError;

    const cookieId = await browserGuestCookie();
    return apiSuccess(await todayActionsSnapshot(createAdminClient(), trip.id, cookieId ?? undefined, user.id));
  } catch (err) {
    console.error("[today-actions member] Unexpected error:", err);
    return errors.internal("Internal server error", "TodayActions");
  }
}
