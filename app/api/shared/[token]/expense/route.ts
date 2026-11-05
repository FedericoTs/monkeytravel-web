/**
 * POST /api/shared/[token]/expense — "Who paid?" on a live trip (Phase 3.4)
 *
 * Logs an expense the actor paid and splits it equally across the trip's
 * group (lib/trips/roster). Participants can be anonymous, so the split
 * targets are a mix of authed users and cookie ids — the extended
 * trip_expenses / trip_expense_splits carry both, and Settle Up counts both.
 *
 * Body: { amount, currency?, activity_id?, description?, category?, undo?, expense_id? }
 * Writes via the service role (the tables' RLS is member-only). Returns the
 * ledger + the viewer's summary (same shape as GET).
 */
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { participantCookieId, readParticipantWrite, setParticipantCookie, signedInUser } from "@/lib/participants/request";
import { expensesSnapshot } from "@/lib/expenses/snapshot";
import { writeTripExpense, type TripExpenseBody } from "@/lib/expenses/write";
import { announceTodayChange } from "@/lib/today/write";
import { readSharedTrip } from "@/lib/trips/shared-trip";

const ipLimiter = createRateLimiter("expense-ip", 30, 60_000);
const cookieTripLimiter = createRateLimiter("expense-cookie-trip", 15, 60_000);

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const write = await readParticipantWrite<TripExpenseBody>(request, context, ipLimiter);
    if (write.errorResponse) return write.errorResponse;
    const { token, body, cookieStore, existingCookie } = write;

    const admin = createAdminClient();
    const { trip, errorResponse } = await readSharedTrip<{ id: string; user_id: string | null; trip_meta: unknown; budget: unknown }>(
      admin,
      token,
      "id, user_id, trip_meta, budget",
    );
    if (errorResponse) return errorResponse;

    const { cookieId, issued: issuedCookie } = participantCookieId(existingCookie);
    const { allowed: cookieAllowed } = await cookieTripLimiter.check(request, `${cookieId}:${trip.id}`);
    if (!cookieAllowed) return errors.rateLimit("Too many changes. Please slow down.");

    const user = await signedInUser();

    const failed = await writeTripExpense(admin, trip, { user, cookieId }, body);
    if (failed) return failed;
    announceTodayChange(admin, trip.id);
    if (issuedCookie) setParticipantCookie(cookieStore, cookieId);
    return apiSuccess(await expensesSnapshot(admin, trip.id, (trip.user_id as string | null) ?? null, user?.id ?? null, cookieId));
  } catch (error) {
    console.error("[expense] Unexpected error:", error);
    return errors.internal("Internal server error", "Expense");
  }
}
