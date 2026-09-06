/**
 * GET /api/shared/[token]/feed — the Today activity feed (Phase 3.5)
 *
 * Participant joins + chip actions + expenses, merged into one chronological
 * stream (lib/feed/snapshot). Service-role read behind the token check; the
 * mt_anon_voter cookie / owner session only sets whose actions read as "you"
 * downstream. Never mints a cookie. TodayView refetches this after chip and
 * expense mutations, so no separate realtime channel is needed.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE, isUuid } from "@/lib/participants/shared";
import { feedSnapshot } from "@/lib/feed/snapshot";
import type { ItineraryDay } from "@/types";

export async function GET(_request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { token } = await context.params;
    if (!token || !isUuid(token)) return errors.badRequest("Invalid share token");

    const admin = createAdminClient();
    const { data: trip, error } = await admin
      .from("trips")
      .select("id, user_id, itinerary")
      .eq("share_token", token)
      .single();
    if (error || !trip) return errors.notFound("Shared trip not found");

    const cookieId = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }

    const events = await feedSnapshot(
      admin,
      {
        id: trip.id as string,
        user_id: (trip.user_id as string | null) ?? null,
        itinerary: (trip.itinerary as ItineraryDay[] | null) ?? null,
      },
      cookieId,
      userId,
    );
    return apiSuccess({ events });
  } catch (err) {
    console.error("[feed] Unexpected error:", err);
    return errors.internal("Internal server error", "Feed");
  }
}
