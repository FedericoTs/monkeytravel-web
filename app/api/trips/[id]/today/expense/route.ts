/**
 * POST /api/trips/[id]/today/expense — "Who paid?" on Today, for members.
 *
 * The members' mirror of /api/shared/[token]/expense: the owner and
 * collaborators log a payment from the trip page, whether or not the trip
 * has a share link. Same body and response; the payment itself is
 * lib/expenses/write.
 */
import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { TripRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { browserGuestCookie } from "@/lib/today/actor";
import { expensesSnapshot } from "@/lib/expenses/snapshot";
import { writeTripExpense, type TripExpenseBody } from "@/lib/expenses/write";

const memberTripLimiter = createRateLimiter("expense-member-trip", 15, 60_000);

export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { allowed } = await memberTripLimiter.check(request, `${user.id}:${id}`);
    if (!allowed) return errors.rateLimit("Too many changes. Please slow down.");

    const { trip, errorResponse: accessError } = await verifyTripAccess(supabase, id, user.id, "id, user_id, budget");
    if (accessError) return accessError;

    const body = (await request.json().catch(() => null)) as TripExpenseBody | null;
    if (!body || typeof body !== "object") return errors.badRequest("Invalid request body");

    const admin = createAdminClient();
    const cookieId = await browserGuestCookie();
    const failed = await writeTripExpense(admin, trip, { user, cookieId }, body);
    if (failed) return failed;
    return apiSuccess(await expensesSnapshot(admin, trip.id, trip.user_id, user.id, cookieId ?? undefined));
  } catch (error) {
    console.error("[expense member] Unexpected error:", error);
    return errors.internal("Internal server error", "Expense");
  }
}
