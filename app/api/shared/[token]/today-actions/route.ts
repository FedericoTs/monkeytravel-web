/**
 * GET /api/shared/[token]/today-actions — hydrate the chip overlay (Phase 3.3)
 *
 * Active today-actions for the trip, with `mine` set from the mt_anon_voter
 * cookie / owner session. Realtime keeps it current after this initial load.
 * Never mints a cookie.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedInUserId } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE, isUuid } from "@/lib/participants/shared";
import { todayActionsSnapshot } from "@/lib/today/snapshot";

export async function GET(_request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { token } = await context.params;
    if (!token || !isUuid(token)) return errors.badRequest("Invalid share token");

    const admin = createAdminClient();
    // The trip lookup, the participant cookie and the viewer are independent.
    const [{ data: trip, error }, cookieStore, userId] = await Promise.all([
      admin.from("trips").select("id, user_id").eq("share_token", token).is("deleted_at", null).single(),
      cookies(),
      signedInUserId(),
    ]);
    if (error || !trip) return errors.notFound("Shared trip not found");

    const cookieId = cookieStore.get(PARTICIPANT_COOKIE)?.value;
    return apiSuccess(await todayActionsSnapshot(admin, trip.id, cookieId, userId));
  } catch (err) {
    console.error("[today-actions] Unexpected error:", err);
    return errors.internal("Internal server error", "TodayActions");
  }
}
