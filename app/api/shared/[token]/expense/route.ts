/**
 * POST /api/shared/[token]/expense — "Who paid?" on a live trip (Phase 3.4)
 *
 * Logs an expense the actor paid and splits it equally across the trip's
 * participants (the "I'm going" people, Phase 2) plus the owner. Participants
 * are anonymous, so the split targets are a mix of authed users and cookie
 * ids — the extended trip_expenses / trip_expense_splits carry both. The
 * authed Settle Up (compute_trip_settlements) ignores the anonymous rows.
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
import { captureServerEvent } from "@/lib/posthog/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import { PARTICIPANT_COOKIE, PARTICIPANT_COOKIE_MAX_AGE_SECONDS, isUuid } from "@/lib/participants/shared";
import { centsToAmount, normalizeCurrency, parseAmountToCents, parseExpenseCategory, splitEquallyCents } from "@/lib/expenses/shared";
import { expensesSnapshot } from "@/lib/expenses/snapshot";

const ipLimiter = createRateLimiter("expense-ip", 30, 60_000);
const cookieTripLimiter = createRateLimiter("expense-cookie-trip", 15, 60_000);
const BOT_UA_REGEX = /^(curl|wget|python-requests|httpie|go-http-client|libwww-perl|scrapy)\b/i;

interface Body {
  amount?: unknown;
  currency?: unknown;
  activity_id?: unknown;
  description?: unknown;
  category?: unknown;
  undo?: unknown;
  expense_id?: unknown;
}

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

    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object") return errors.badRequest("Invalid request body");

    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, user_id, trip_meta, budget")
      .eq("share_token", token)
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

    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }
    const isOwner = !!userId && userId === trip.user_id;

    const finish = async () => {
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
      return apiSuccess(await expensesSnapshot(admin, trip.id, (trip.user_id as string | null) ?? null, userId, cookieId));
    };

    // ---- Undo: the creator (or owner) deletes their expense; splits cascade.
    if (body.undo === true) {
      const expenseId = typeof body.expense_id === "string" ? body.expense_id : "";
      if (!expenseId || !isUuid(expenseId)) return errors.badRequest("Invalid expense_id");
      let del = admin.from("trip_expenses").delete().eq("id", expenseId).eq("trip_id", trip.id);
      if (!isOwner) del = del.eq("created_by_cookie_id", cookieId);
      const { error } = await del;
      if (error) {
        console.error("[expense] undo failed:", error);
        return errors.internal("Could not remove the expense", "Expense");
      }
      return finish();
    }

    // ---- Add an expense.
    const amountCents = parseAmountToCents(body.amount);
    if (!amountCents) return errors.badRequest("Enter an amount greater than zero");
    const currency = normalizeCurrency(
      (typeof body.currency === "string" && body.currency) || (trip.budget as { currency?: string } | null)?.currency,
    );
    const category = parseExpenseCategory(body.category);
    const activityId =
      typeof body.activity_id === "string" && body.activity_id.length > 0 && body.activity_id.length <= 100 ? body.activity_id : null;
    const description =
      typeof body.description === "string" && body.description.trim().length > 0 ? body.description.trim().slice(0, 280) : null;

    // Actor name (owner → null, rendered "The owner"; participant → their name).
    let actorName: string | null = null;
    if (!isOwner) {
      const { data: me } = await admin
        .from("trip_participants")
        .select("display_name")
        .eq("trip_id", trip.id)
        .eq("participant_cookie_id", cookieId)
        .maybeSingle();
      actorName = (me?.display_name as string | null) ?? null;
    }

    // Split cohort: active participants + the owner, unified and deduped by key.
    const { data: participants } = await admin
      .from("trip_participants")
      .select("participant_cookie_id, user_id, display_name")
      .eq("trip_id", trip.id)
      .is("left_at", null);
    type Member = { userId: string | null; cookieId: string | null; name: string | null };
    const cohort = new Map<string, Member>();
    const add = (m: Member) => {
      const key = m.userId ? `u:${m.userId}` : m.cookieId ? `c:${m.cookieId}` : null;
      if (key && !cohort.has(key)) cohort.set(key, m);
    };
    // The owner always shares.
    add({ userId: trip.user_id as string, cookieId: null, name: null });
    for (const p of participants ?? []) {
      add({
        userId: (p.user_id as string | null) ?? null,
        cookieId: (p.participant_cookie_id as string | null) ?? null,
        name: (p.display_name as string | null) ?? null,
      });
    }
    // The payer shares too, even if they haven't tapped "I'm going".
    add({ userId: isOwner ? (userId as string) : null, cookieId: isOwner ? null : cookieId, name: actorName });

    const members = [...cohort.values()];
    const shares = splitEquallyCents(amountCents, members.length);

    const { data: inserted, error: insErr } = await admin
      .from("trip_expenses")
      .insert({
        trip_id: trip.id,
        amount: centsToAmount(amountCents),
        currency,
        category,
        description,
        activity_id: activityId,
        created_by: isOwner ? userId : null,
        created_by_cookie_id: isOwner ? null : cookieId,
        created_by_name: actorName,
        paid_by_user_id: isOwner ? userId : null,
        paid_by_cookie_id: isOwner ? null : cookieId,
        paid_by_name: actorName,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("[expense] insert failed:", insErr);
      return errors.internal("Could not save the expense", "Expense");
    }

    const splitRows = members.map((m, i) => ({
      expense_id: inserted.id,
      user_id: m.userId,
      participant_cookie_id: m.userId ? null : m.cookieId,
      participant_name: m.name,
      share_amount: centsToAmount(shares[i]),
    }));
    const { error: splitErr } = await admin.from("trip_expense_splits").insert(splitRows);
    if (splitErr) {
      // Compensate: an expense with no splits would skew the summary.
      console.error("[expense] split insert failed, rolling back expense:", splitErr);
      await admin.from("trip_expenses").delete().eq("id", inserted.id);
      return errors.internal("Could not save the expense", "Expense");
    }

    captureServerEvent(isOwner ? (userId as string) : cookieId, "trip_expense_added", {
      trip_id: trip.id,
      amount_cents: amountCents,
      currency,
      split_across: members.length,
      role: isOwner ? "owner" : "participant",
    });

    return finish();
  } catch (error) {
    console.error("[expense] Unexpected error:", error);
    return errors.internal("Internal server error", "Expense");
  }
}
