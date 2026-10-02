import "server-only";
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/response-wrapper";
import { captureServerEvent } from "@/lib/posthog/server";
import { isUuid } from "@/lib/participants/shared";
import { isTodayActor, resolveTodayPerson, storedCookie } from "@/lib/today/actor";
import type { TodayRequester } from "@/lib/today/write";
import { expenseCohort, tripRoster } from "@/lib/trips/roster";
import { centsToAmount, normalizeCurrency, parseAmountToCents, parseExpenseCategory, splitEquallyCents } from "./shared";

/**
 * "Who paid?" on a live trip's Today, shared by the share-link route
 * (/api/shared/[token]/expense) and the members' route
 * (/api/trips/[id]/today/expense). Each route finds the trip and the person
 * its own way; what happens to the payment is the same.
 */

export interface TripExpenseBody {
  amount?: unknown;
  currency?: unknown;
  activity_id?: unknown;
  description?: unknown;
  category?: unknown;
  undo?: unknown;
  expense_id?: unknown;
}

/** Adds or removes a payment. Returns the error to answer with, or null once the change is written. */
export async function writeTripExpense(
  admin: SupabaseClient,
  trip: { id: string; user_id: string | null; budget?: unknown },
  requester: TodayRequester,
  body: TripExpenseBody,
): Promise<NextResponse | null> {
  const { user, cookieId } = requester;
  const userId = user?.id ?? null;
  const isOwner = !!userId && userId === trip.user_id;
  const actor = { userId, cookieId };

  // ---- Undo: the creator (or owner) deletes their expense; splits cascade.
  if (body.undo === true) {
    const expenseId = typeof body.expense_id === "string" ? body.expense_id : "";
    if (!expenseId || !isUuid(expenseId)) return errors.badRequest("Invalid expense_id");
    const { data: row, error: readError } = await admin
      .from("trip_expenses")
      .select("created_by, created_by_cookie_id")
      .eq("id", expenseId)
      .eq("trip_id", trip.id)
      .maybeSingle();
    if (readError) {
      console.error("[expense] undo read failed:", readError);
      return errors.internal("Could not remove the expense", "Expense");
    }
    const by = { userId: (row?.created_by as string | null) ?? null, cookieId: (row?.created_by_cookie_id as string | null) ?? null };
    if (row && (isOwner || isTodayActor(actor, by))) {
      const { error } = await admin.from("trip_expenses").delete().eq("id", expenseId);
      if (error) {
        console.error("[expense] undo failed:", error);
        return errors.internal("Could not remove the expense", "Expense");
      }
    }
    return null;
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

  const person = await resolveTodayPerson(admin, trip, user, cookieId);
  const actorName = person.name;

  // Split across the trip's group, the payer included once (lib/trips/roster).
  const { roster, error: rosterError } = await tripRoster(admin, trip);
  if (rosterError) {
    console.error("[expense] group lookup failed:", rosterError);
    return errors.internal("Could not save the expense", "Expense");
  }
  const members = expenseCohort(roster, { userId: person.userId, cookieId: storedCookie(person), name: actorName });
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
      // A creator account can edit the row through the table's policies, so
      // only members get one; anyone else stays the creator by this browser.
      created_by: person.isMember ? person.userId : null,
      created_by_cookie_id: person.isMember ? null : cookieId,
      created_by_name: actorName,
      paid_by_user_id: person.userId,
      paid_by_cookie_id: storedCookie(person),
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

  captureServerEvent(userId ?? cookieId ?? "anon", "trip_expense_added", {
    trip_id: trip.id,
    amount_cents: amountCents,
    currency,
    split_across: members.length,
    role: isOwner ? "owner" : "participant",
  });
  return null;
}
