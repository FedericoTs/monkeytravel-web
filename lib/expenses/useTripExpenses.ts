"use client";

import { useCallback, useEffect, useState } from "react";
import { keepIfSame } from "@/lib/today/refresh-throttle";
import { freshness, readSignal } from "@/lib/today/freshness";
import { TodayWriteError, todayErrorKey, type TodayErrorKey } from "@/lib/today/errors";
import type { ExpensePublic, ExpenseSummary } from "./shared";

/**
 * The live-trip expense ledger on the client — Live Trip Phase 3.4.
 *
 * Fetch on mount + refetch after every mutation, so the actor sees their own
 * change immediately, and `refetch` when the Today broadcast announces a
 * change (TodayView passes it to useTodayActions), so other viewers see it
 * too. No subscription of its own: the money tables keep member-only RLS (no
 * public SELECT), so amounts stay on the service-role routes.
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
  error: TodayErrorKey | null;
  add: (input: AddExpenseInput) => Promise<boolean>;
  /** Resolves false when the removal didn't go through. */
  remove: (expenseId: string, options?: { keepalive?: boolean }) => Promise<boolean>;
  /** Reads the ledger again; keeps what's shown if nothing changed. */
  refetch: () => Promise<void>;
}

/** `base` is the routes Today uses: the share link's, or the members' /api/trips/[id]/today. */
export function useTripExpenses(base: string, enabled: boolean): TripExpensesApi {
  const [expenses, setExpenses] = useState<ExpensePublic[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TodayErrorKey | null>(null);
  const [fresh] = useState(freshness);

  const applyResult = (json: unknown) => {
    const data = (json as { data?: { expenses?: ExpensePublic[]; summary?: ExpenseSummary } })?.data ?? json;
    const d = data as { expenses?: ExpensePublic[]; summary?: ExpenseSummary };
    if (Array.isArray(d?.expenses)) setExpenses((prev) => keepIfSame(prev, d.expenses as ExpensePublic[]));
    if (d?.summary) setSummary((prev) => keepIfSame(prev, d.summary as ExpenseSummary));
  };

  const fetchLedger = useCallback(async () => {
    const current = fresh.startRead();
    try {
      const res = await fetch(`${base}/expenses`, { cache: "no-store", signal: readSignal() });
      if (!res.ok) return;
      const json = await res.json();
      if (current()) applyResult(json);
    } catch {
      // leave the last-known ledger in place
    }
  }, [base, fresh]);

  useEffect(() => {
    if (!enabled) return;
    void fetchLedger();
  }, [enabled, fetchLedger]);

  const post = useCallback(
    (body: Record<string, unknown>, keepalive = false) =>
      fresh.write(async () => {
        const res = await fetch(`${base}/expense`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          keepalive,
        });
        // A 400 on an add is the amount the route could not read.
        if (!res.ok) throw new TodayWriteError(res.status === 400 && !body.undo ? "amount" : todayErrorKey(res.status));
        applyResult(await res.json());
      }),
    [base, fresh],
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
        setError(e instanceof TodayWriteError ? e.key : "failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, post],
  );

  // Sent once Undo has had its chance (TodayExpenses), so a change in flight
  // must not drop it; keepalive lets it outlive a page being closed.
  const remove = useCallback<TripExpensesApi["remove"]>(
    async (expenseId, options) => {
      setError(null);
      try {
        await post({ undo: true, expense_id: expenseId }, options?.keepalive);
        return true;
      } catch (e) {
        setError(e instanceof TodayWriteError ? e.key : "failed");
        return false;
      }
    },
    [post],
  );

  return { expenses, summary, busy, error, add, remove, refetch: fetchLedger };
}
