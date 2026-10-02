/**
 * GET /api/shared/[token]/participants — who's going (Live Trip Phase 2.1)
 *
 * Hydration for the recipient page: active participant count, up to eight
 * names (what participants typed, oldest first) and the viewer's own row, by
 * their account when signed in, else via the mt_anon_voter cookie. Never
 * mints a cookie — only /join does.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE, isUuid } from "@/lib/participants/shared";
import { participantsSnapshot } from "@/lib/participants/snapshot";

export async function GET(_request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) {
      return errors.notFound("Not available");
    }
    const { token } = await context.params;
    if (!token || !isUuid(token)) {
      return errors.badRequest("Invalid share token");
    }
    const admin = createAdminClient();
    const { data: trip, error } = await admin
      .from("trips")
      .select("id")
      .eq("share_token", token)
      .is("deleted_at", null)
      .single();
    if (error || !trip) {
      return errors.notFound("Shared trip not found");
    }
    const cookieId = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
    const { data: auth } = await (await createClient()).auth.getUser();
    return apiSuccess(await participantsSnapshot(admin, trip.id, cookieId, auth.user?.id ?? null));
  } catch (err) {
    console.error("[Shared Participants] Unexpected error:", err);
    return errors.internal("Internal server error", "SharedParticipants");
  }
}
