"use client";

import { useTranslations } from "next-intl";

/**
 * The result's dates note: the dates pencilled in for the traveller, with the
 * way to set their own; the trip being extended; or why a longer trip's extra
 * days could not be planned.
 */
export default function ResultDatesNotice({
  planningExtraDays,
  datesNotice,
  dateRange,
  onSetDates,
}: {
  planningExtraDays: boolean;
  datesNotice: string | null;
  /** The pencilled-in dates, as the hero shows them. */
  dateRange: string;
  onSetDates: () => void;
}) {
  const t = useTranslations("trips");
  return (
    <div className="max-w-6xl mx-auto px-4 pt-4">
      <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        {planningExtraDays ? (
          <span>{t("wizard.changeDates.planning")}</span>
        ) : datesNotice ? (
          <span>{datesNotice}</span>
        ) : (
          <>
            <span>{t("wizard.changeDates.pencilled", { range: dateRange })}</span>
            <button
              type="button"
              onClick={onSetDates}
              className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700"
            >
              {t("wizard.changeDates.setYourDates")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
