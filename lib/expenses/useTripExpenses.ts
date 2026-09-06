"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExpensePublic, ExpenseSummary } from "./shared";

/**
 * The live-trip expense ledger on the client — Live Trip Phase 3.4.
 *
 * Fetch on mount + refetch after every mutation, so the actor sees their own
 * change immediately and other viewers pick it up on their next load. No
 * realtime here on purpose: the money tables keep member-only RLS (no public
 * SELECT), so an anon browser can't subscribe; going through the service-role
 * routes keeps amounts off the public read path.
 */
export interface AddExpenseInput {
  amount: string;
  activityId?: string | null;
  description?: string | null;
  category?: string;
}

export interface TripExpensesApi {
  expenses: ExpensePublic[];
  summary: ExpenseSummary | null;
  busy: boolean;
  error: string | null;
  add: (input: AddExpenseInput) => Promise<boolean>;
  remove: (expenseId: string) => Promise<void>;
}

export function useTripExpenses(shareToken: string, enabled: boolean): TripExpensesApi {
  const [expenses, setExpenses] = useState<ExpensePublic[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/shared/${shareToken}`;

  const applyResult = (json: unknown) => {
    const data = (json as { data?: { expenses?: ExpensePublic[]; summary?: ExpenseSummary } })?.data ?? json;
    const d = data as { expenses?: ExpensePublic[]; summary?: ExpenseSummary };
    if (Array.isArray(d?.expenses)) setExpenses(d.expenses);
    if (d?.summary) setSummary(d.summary);
  };

  const fetchLedger = useCallback(async () => {
    try {
      const res = await fetch(`${base}/expenses`, { cache: "no-store" });
      if (!res.ok) return;
      applyResult(await res.json());
    } catch {
      // leave the last-known ledger in place
    }
  }, [base]);

  useEffect(() => {
    if (!enabled) return;
    void fetchLedger();
  }, [enabled, fetchLedger]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`${base}/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || j?.message || "That didn't work.");
      }
      applyResult(await res.json());
    },
    [base],
  );

  const add = useCallback<TripExpensesApi["add"]>(
    async ({ amount, activityId, description, category }) => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        await post({ amount, activity_id: activityId ?? undefined, description: description ?? undefined, category });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, post],
  );

  const remove = useCallback<TripExpensesApi["remove"]>(
    async (expenseId) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await post({ undo: true, expense_id: expenseId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      } finally {
        setBusy(false);
      }
    },
    [busy, post],
  );

  return { expenses, summary, busy, error, add, remove };
}
