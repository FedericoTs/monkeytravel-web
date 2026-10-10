"use client";

/**
 * "Which amount did you mean?" for a typed amount that reads two ways
 * (readAmount in lib/expenses/shared): one button per reading, written with
 * two decimals in the app's language so each reads one way only.
 */
import { useLocale, useTranslations } from "next-intl";
import { formatAmount } from "@/lib/expenses/shared";

interface AmountChoicesProps {
  options: number[];
  onPick: (cents: number) => void;
  disabled?: boolean;
  className?: string;
}

export default function AmountChoices({ options, onPick, disabled = false, className = "" }: AmountChoicesProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  return (
    <div role="group" aria-live="polite" aria-label={t("expenses.amountWhich")} data-testid="amount-choices" className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-xs text-slate-600">{t("expenses.amountWhich")}</span>
      {options.map((cents) => (
        <button
          key={cents}
          type="button"
          onClick={() => onPick(cents)}
          disabled={disabled}
          className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          {formatAmount(cents, locale)}
        </button>
      ))}
    </div>
  );
}
