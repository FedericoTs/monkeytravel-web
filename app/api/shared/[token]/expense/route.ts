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
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE, PARTICIPANT_COOKIE_MAX_AGE_SECONDS, isUuid } from "@/lib/participants/shared";
import { expensesSnapshot } from "@/lib/expenses/snapshot";
import { writeTripExpense, type TripExpenseBody } from "@/lib/expenses/write";

const ipLimiter = createRateLimiter("expense-ip", 30, 60_000);
const cookieTripLimiter = createRateLimiter("expense-cookie-trip", 15, 60_000);
const BOT_UA_REGEX = /^(curl|wget|python-requests|httpie|go-http-client|libwww-perl|scrapy)\b/i;

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) return errors.notFound("Not available");
    const { token } = await context.params;
    if (!token || !isUuid(token)) return errors.badRequest("Invalid share token");

    const { allowed: ipAllowed } = await ipLimiter.check(request);
    if (!ipAllowed) return errors.rateLimit("Too many requests. Please slow down.");

    const cookieStore = await cookies();
    const existingCookie = cookieStore.get(PARTICIPANT_COOKIE)?.value;
    if (!existingCookie) {
      const ua = request.headers.get("user-agent") ?? "";
      if (!ua || BOT_UA_REGEX.test(ua)) return errors.badRequest("Invalid request");
    }

    const body = (await request.json().catch(() => null)) as TripExpenseBody | null;
    if (!body || typeof body !== "object") return errors.badRequest("Invalid request body");

    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, user_id, trip_meta, budget")
      .eq("share_token", token)
      .is("deleted_at", null)
      .single();
    if (tripError || !trip) return errors.notFound("Shared trip not found");

    let cookieId = existingCookie;
    let issuedCookie = false;
    if (!cookieId || cookieId.length < 10 || cookieId.length > 60) {
      cookieId = nanoid(21);
      issuedCookie = true;
    }
    const { allowed: cookieAllowed } = await cookieTripLimiter.check(request, `${cookieId}:${trip.id}`);
    if (!cookieAllowed) return errors.rateLimit("Too many changes. Please slow down.");

    let user: { id: string; email?: string | null } | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      user = data.user ?? null;
    } catch {
      user = null;
    }

    const failed = await writeTripExpense(admin, trip, { user, cookieId }, body);
    if (failed) return failed;
    if (issuedCookie) {
      cookieStore.set({
        name: PARTICIPANT_COOKIE,
        value: cookieId,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: PARTICIPANT_COOKIE_MAX_AGE_SECONDS,
        path: "/",
      });
    }
    return apiSuccess(await expensesSnapshot(admin, trip.id, (trip.user_id as string | null) ?? null, user?.id ?? null, cookieId));
  } catch (error) {
    console.error("[expense] Unexpected error:", error);
    return errors.internal("Internal server error", "Expense");
  }
}
