/**
 * GET /api/shared/[token]/expenses — the live-trip expense ledger (Phase 3.4)
 *
 * The trip's expenses + the viewer's paid/owed/net summary, keyed off the
 * mt_anon_voter cookie / owner session. Service-role read behind the token
 * check. No cookie is minted here.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE } from "@/lib/participants/shared";
import { expensesSnapshot } from "@/lib/expenses/snapshot";
import { readSharedTrip } from "@/lib/trips/shared-trip";
import { isUuid } from "@/lib/utils/uuid";
import { signedInUser } from "@/lib/participants/request";

export async function GET(_request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { token } = await context.params;
    if (!token || !isUuid(token)) return errors.badRequest("Invalid share token");

    const admin = createAdminClient();
    const { trip, errorResponse } = await readSharedTrip<{ id: string; user_id: string | null }>(admin, token, "id, user_id");
    if (errorResponse) return errorResponse;

    const cookieId = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
    const userId = (await signedInUser())?.id ?? null;
    return apiSuccess(await expensesSnapshot(admin, trip.id, (trip.user_id as string | null) ?? null, userId, cookieId));
  } catch (err) {
    console.error("[expenses] Unexpected error:", err);
    return errors.internal("Internal server error", "Expenses");
  }
}
