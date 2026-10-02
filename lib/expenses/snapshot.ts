import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorKey,
  summarize,
  type ExpenseCategory,
  type ExpenseLedgerEntry,
  type ExpensePublic,
  type ExpenseSummary,
} from "./shared";
import { isTodayActor } from "@/lib/today/actor";

export interface ExpensesSnapshot {
  expenses: ExpensePublic[];
  summary: ExpenseSummary;
}

/**
 * A trip's expense rows, newest first, each with its ledger entry: what the
 * Today summary and Settle Up both add up. Server-only, since a guest's key is
 * their browser cookie. A failed read comes back as `error`, with what was read.
 */
export async function readExpenseLedger(
  admin: SupabaseClient,
  tripId: string,
): Promise<{ rows: Record<string, unknown>[]; ledger: ExpenseLedgerEntry[]; error: unknown }> {
  const { data: rows, error } = await admin
    .from("trip_expenses")
    .select(
      "id, activity_id, amount, currency, category, description, paid_by_user_id, paid_by_cookie_id, paid_by_name, created_by, created_by_cookie_id, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });
  if (error) return { rows: [], ledger: [], error };
  const expenseRows = rows ?? [];
  const ids = expenseRows.map((r) => r.id as string);

  const splitsByExpense = new Map<string, ExpenseLedgerEntry["splits"]>();
  let splitsError: unknown = null;
  if (ids.length > 0) {
    const { data: splits, error: sErr } = await admin
      .from("trip_expense_splits")
      .select("expense_id, user_id, participant_cookie_id, participant_name, share_amount")
      .in("expense_id", ids);
    splitsError = sErr;
    for (const s of splits ?? []) {
      const key = actorKey((s.user_id as string | null) ?? null, (s.participant_cookie_id as string | null) ?? null);
      const list = splitsByExpense.get(s.expense_id as string) ?? [];
      list.push({ key, name: (s.participant_name as string | null) ?? null, shareCents: Math.round(Number(s.share_amount) * 100) });
      splitsByExpense.set(s.expense_id as string, list);
    }
  }

  const ledger: ExpenseLedgerEntry[] = expenseRows.map((r) => ({
    currency: r.currency as string,
    amountCents: Math.round(Number(r.amount) * 100),
    paidByKey: actorKey((r.paid_by_user_id as string | null) ?? null, (r.paid_by_cookie_id as string | null) ?? null),
    paidByName: (r.paid_by_name as string | null) ?? null,
    splits: splitsByExpense.get(r.id as string) ?? [],
  }));
  return { rows: expenseRows, ledger, error: splitsError };
}

/**
 * The live-trip expense ledger for one trip, shaped for the client, with the
 * viewer's paid/owed/net summary. Service-role read behind the route's access
 * check. Live Trip Phase 3.4.
 */
export async function expensesSnapshot(
  admin: SupabaseClient,
  tripId: string,
  ownerUserId: string | null,
  viewerUserId: string | null,
  viewerCookieId: string | undefined,
): Promise<ExpensesSnapshot> {
  const ownerKey = ownerUserId ? actorKey(ownerUserId, null) : null;
  const { rows, ledger, error } = await readExpenseLedger(admin, tripId);
  if (error) console.error("[expenses] snapshot read failed:", error);

  const viewerKey = actorKey(viewerUserId, viewerCookieId ?? null);
  const expenses: ExpensePublic[] = rows.map((r, i) => {
    const entry = ledger[i];
    return {
      id: r.id as string,
      activityId: (r.activity_id as string | null) ?? null,
      amountCents: entry.amountCents,
      currency: entry.currency,
      category: (r.category as ExpenseCategory) ?? "other",
      description: (r.description as string | null) ?? null,
      paidByName: entry.paidByName,
      paidByIsOwner: ownerKey !== null && entry.paidByKey === ownerKey,
      // "mine" = the viewer created it (drives the delete control), by account
      // or on this browser, matching the delete route.
      mine: isTodayActor(
        { userId: viewerUserId, cookieId: viewerCookieId ?? null },
        { userId: (r.created_by as string | null) ?? null, cookieId: (r.created_by_cookie_id as string | null) ?? null },
      ),
      createdAt: r.created_at as string,
      // Names and amounts only; the keys stay in the ledger.
      splits: entry.splits.map(({ name, shareCents }) => ({ name, shareCents })),
    };
  });

  return { expenses, summary: summarize(ledger, viewerKey) };
}
