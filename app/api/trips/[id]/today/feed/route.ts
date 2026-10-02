/**
 * GET /api/trips/[id]/today/feed — the Today activity feed, for members.
 *
 * The members' mirror of /api/shared/[token]/feed, read on the trip page
 * whether or not the trip has a share link. Same response.
 */
import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { browserGuestCookie } from "@/lib/today/actor";
import { allowTodayRead } from "@/lib/today/read-limit";
import { feedSnapshot } from "@/lib/feed/snapshot";
import type { ItineraryDay } from "@/types";

export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;
    if (!(await allowTodayRead(request, id, user.id))) return errors.rateLimit("Too many requests. Please slow down.");
    const { trip, errorResponse: accessError } = await verifyTripAccess(supabase, id, user.id, "id, user_id, itinerary");
    if (accessError) return accessError;

    const cookieId = await browserGuestCookie();
    const events = await feedSnapshot(
      createAdminClient(),
      { id: trip.id, user_id: trip.user_id, itinerary: (trip.itinerary as ItineraryDay[] | null) ?? null },
      cookieId ?? undefined,
      user.id,
    );
    return apiSuccess({ events });
  } catch (err) {
    console.error("[feed member] Unexpected error:", err);
    return errors.internal("Internal server error", "Feed");
  }
}
