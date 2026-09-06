import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorKey,
  summarize,
  type ExpenseCategory,
  type ExpensePublic,
  type ExpenseSummary,
} from "./shared";

export interface ExpensesSnapshot {
  expenses: ExpensePublic[];
  summary: ExpenseSummary;
}

/**
 * The live-trip expense ledger for one trip, shaped for the client, with the
 * viewer's paid/owed/net summary. Service-role read behind the /shared route's
 * token check. Computes over authed AND anonymous splitters (unlike the authed
 * compute_trip_settlements). Live Trip Phase 3.4.
 */
export async function expensesSnapshot(
  admin: SupabaseClient,
  tripId: string,
  ownerUserId: string | null,
  viewerUserId: string | null,
  viewerCookieId: string | undefined,
): Promise<ExpensesSnapshot> {
  const ownerKey = ownerUserId ? actorKey(ownerUserId, null) : null;
  const { data: rows, error } = await admin
    .from("trip_expenses")
    .select(
      "id, activity_id, amount, currency, category, description, paid_by_user_id, paid_by_cookie_id, paid_by_name, created_by, created_by_cookie_id, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[expenses] snapshot read failed:", error);
    return { expenses: [], summary: emptySummary() };
  }
  const expenseRows = rows ?? [];
  const ids = expenseRows.map((r) => r.id as string);

  const splitsByExpense = new Map<string, { key: string; name: string | null; shareCents: number }[]>();
  if (ids.length > 0) {
    const { data: splits, error: sErr } = await admin
      .from("trip_expense_splits")
      .select("expense_id, user_id, participant_cookie_id, participant_name, share_amount")
      .in("expense_id", ids);
    if (sErr) console.error("[expenses] splits read failed:", sErr);
    for (const s of splits ?? []) {
      const key = actorKey((s.user_id as string | null) ?? null, (s.participant_cookie_id as string | null) ?? null);
      const list = splitsByExpense.get(s.expense_id as string) ?? [];
      list.push({ key, name: (s.participant_name as string | null) ?? null, shareCents: Math.round(Number(s.share_amount) * 100) });
      splitsByExpense.set(s.expense_id as string, list);
    }
  }

  const viewerKey = actorKey(viewerUserId, viewerCookieId ?? null);
  const expenses: ExpensePublic[] = expenseRows.map((r) => {
    const paidByKey = actorKey((r.paid_by_user_id as string | null) ?? null, (r.paid_by_cookie_id as string | null) ?? null);
    const createdByKey = actorKey((r.created_by as string | null) ?? null, (r.created_by_cookie_id as string | null) ?? null);
    return {
      id: r.id as string,
      activityId: (r.activity_id as string | null) ?? null,
      amountCents: Math.round(Number(r.amount) * 100),
      currency: r.currency as string,
      category: (r.category as ExpenseCategory) ?? "other",
      description: (r.description as string | null) ?? null,
      paidByKey,
      paidByName: (r.paid_by_name as string | null) ?? null,
      paidByIsOwner: ownerKey !== null && paidByKey === ownerKey,
      // "mine" = the viewer created it (drives the delete control).
      mine: createdByKey === viewerKey && viewerKey !== "c:unknown",
      createdAt: r.created_at as string,
      splits: splitsByExpense.get(r.id as string) ?? [],
    };
  });

  return { expenses, summary: summarize(expenses, viewerKey) };
}

function emptySummary(): ExpenseSummary {
  return { currency: "EUR", totalCents: 0, youPaidCents: 0, youOweCents: 0, netCents: 0, count: 0 };
}
