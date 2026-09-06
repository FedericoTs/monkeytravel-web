"use client";

/**
 * Inline "Who paid?" quick-add — Live Trip Phase 3.4. A compact button that
 * expands to an amount field; used per activity in Today and once at the day
 * level. Submitting logs the expense (the caller wires it to the trip's split).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

interface ExpenseQuickAddProps {
  onAdd: (amount: string) => Promise<boolean>;
  busy: boolean;
  /** Compact per-activity variant vs the roomier day-level one. */
  variant?: "inline" | "block";
  className?: string;
}

export default function ExpenseQuickAdd({ onAdd, busy, variant = "inline", className = "" }: ExpenseQuickAddProps) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const submit = async () => {
    if (!amount.trim()) return;
    const ok = await onAdd(amount.trim());
    if (ok) {
      setAmount("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="expense-add-open"
        className={
          variant === "inline"
            ? `inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 ${className}`
            : `inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--secondary)]/10 px-4 text-sm font-semibold text-[var(--secondary)] hover:bg-[var(--secondary)]/15 ${className}`
        }
      >
        <span aria-hidden>💶</span>
        {t("today.expenses.whoPaid")}
      </button>
    );
  }

  return (
    <form
      className={`flex flex-wrap items-center gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        data-testid="expense-amount"
        autoFocus
        placeholder={t("today.expenses.amountPlaceholder")}
        className="min-h-[40px] w-28 rounded-lg border border-slate-300 px-3 text-sm focus:border-[var(--primary)] focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy || !amount.trim()}
        data-testid="expense-save"
        className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {t("today.expenses.save")}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setAmount("");
        }}
        className="min-h-[40px] px-2 text-sm text-slate-500 hover:text-slate-700"
      >
        {t("today.expenses.cancel")}
      </button>
    </form>
  );
}
