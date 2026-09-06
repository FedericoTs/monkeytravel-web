"use client";

/**
 * The live-trip expense panel in Today — Live Trip Phase 3.4.
 *
 * A summary (spent so far · you're owed / you owe), a day-level "Who paid?"
 * add, and the recent ledger with a delete on your own rows. Splitting is
 * across the trip's participants; the per-activity add lives on each activity
 * card (ExpenseQuickAdd), this is the day view of the result.
 */
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { centsToAmount, type ExpensePublic, type ExpenseSummary } from "@/lib/expenses/shared";
import ExpenseQuickAdd from "@/components/trip/ExpenseQuickAdd";

interface TodayExpensesProps {
  expenses: ExpensePublic[];
  summary: ExpenseSummary | null;
  busy: boolean;
  error: string | null;
  onAdd: (amount: string) => Promise<boolean>;
  onRemove: (expenseId: string) => void;
  /** Map activity id → name, to label expenses logged on an activity. */
  activityName: (id: string | null) => string | null;
  className?: string;
}

export default function TodayExpenses({ expenses, summary, busy, error, onAdd, onRemove, activityName, className = "" }: TodayExpensesProps) {
  const t = useTranslations("common");
  const locale = useLocale();

  const money = useMemo(() => {
    const currency = summary?.currency ?? "EUR";
    return (cents: number) => {
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency }).format(centsToAmount(cents));
      } catch {
        return `${centsToAmount(cents).toFixed(2)} ${currency}`;
      }
    };
  }, [summary?.currency, locale]);

  const hasExpenses = expenses.length > 0;
  const net = summary?.netCents ?? 0;

  return (
    <section data-testid="today-expenses" className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`} aria-label={t("today.expenses.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span aria-hidden>🧾</span>
          {t("today.expenses.title")}
        </h3>
        <ExpenseQuickAdd onAdd={onAdd} busy={busy} variant="block" />
      </div>

      {hasExpenses && summary && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="expense-summary">
          <span className="text-sm text-slate-600">
            {t("today.expenses.spentSoFar")} <span className="font-semibold text-slate-900">{money(summary.totalCents)}</span>
          </span>
          {net > 0 ? (
            <span className="text-sm font-semibold text-emerald-700">{t("today.expenses.youAreOwed", { amount: money(net) })}</span>
          ) : net < 0 ? (
            <span className="text-sm font-semibold text-[var(--primary-ink)]">{t("today.expenses.youOwe", { amount: money(-net) })}</span>
          ) : (
            <span className="text-sm text-slate-500">{t("today.expenses.settledUp")}</span>
          )}
        </div>
      )}

      {hasExpenses && (
        <ul className="mt-3 divide-y divide-slate-100" data-testid="expense-list">
          {expenses.slice(0, 8).map((e) => {
            const who = e.paidByName?.trim() || (e.paidByIsOwner ? t("today.owner") : t("today.someone"));
            const label = e.activityId ? activityName(e.activityId) : null;
            return (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">
                    <span className="font-semibold">{who}</span> {t("today.expenses.paid")} <span className="font-semibold">{money(e.amountCents)}</span>
                    {label ? ` · ${label}` : e.description ? ` · ${e.description}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">{t("today.expenses.splitAcross", { count: e.splits.length })}</p>
                </div>
                {e.mine && (
                  <button type="button" onClick={() => onRemove(e.id)} disabled={busy} className="text-xs text-slate-500 hover:text-red-600 underline-offset-2 hover:underline disabled:opacity-50">
                    {t("today.expenses.remove")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!hasExpenses && <p className="mt-2 text-xs text-slate-500">{t("today.expenses.empty")}</p>}
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
    </section>
  );
}
