"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { DayBudget } from "@/components/trip/DayHeader";

/**
 * The end of a day's header: regenerate the day (off while any day
 * regenerates, spinning while this one does), optimize its route, and the
 * day's estimated budget. Each shows only when given.
 */
export default function DayActions({
  dayNumber,
  regeneratingDayNumber,
  onRegenerate,
  onOptimizeRoute,
  budget,
}: {
  dayNumber: number;
  /** The day being regenerated, if any. */
  regeneratingDayNumber: number | null;
  /** Opens the dialog to regenerate this day; null hides the button. */
  onRegenerate: (() => void) | null;
  /** Opens the route optimization for this day; null hides the button. */
  onOptimizeRoute: (() => void) | null;
  /** The day's estimated budget, formatted; null shows none. */
  budget: string | null;
}) {
  const t = useTranslations("trips");
  return (
    <div className="ml-auto flex items-center gap-3">
      {/* Regenerate the day: icon-only and subtle */}
      {onRegenerate && (
        <button
          type="button"
          onClick={() => onRegenerate()}
          disabled={regeneratingDayNumber !== null}
          className="flex items-center justify-center w-8 h-8 rounded-lg
                     text-slate-500 hover:text-[var(--primary-ink)] hover:bg-slate-100
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          title={t('detail.regenerateDay.button', { number: dayNumber })}
          aria-label={t('detail.regenerateDay.button', { number: dayNumber })}
        >
          <RefreshCw
            className={`w-4 h-4 ${regeneratingDayNumber === dayNumber ? "animate-spin" : ""}`}
          />
        </button>
      )}
      {/* Optimize the day's route */}
      {onOptimizeRoute && (
        <button
          onClick={() => onOptimizeRoute()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                     text-emerald-700 bg-emerald-50 hover:bg-emerald-100
                     rounded-lg transition-colors border border-emerald-200"
          title={t('detail.optimizeRoute')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span className="hidden sm:inline">{t('detail.optimizeRoute')}</span>
          <span className="sm:hidden">{t('detail.optimize')}</span>
        </button>
      )}
      {budget !== null && (
        <DayBudget label={t('detail.estBudget')} value={budget} className="text-right" />
      )}
    </div>
  );
}
