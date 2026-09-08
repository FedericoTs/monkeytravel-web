"use client";

/**
 * "Move to another day" — the explicit, no-drag path for moving an activity.
 *
 * Reached from an activity card's ⋯ menu. Lists every day of the trip as a
 * large row (date, city on multi-city trips, how many activities are already
 * there, "empty" when none) so the choice is informed, and disables the day
 * the activity is already on. Picking a day hands the day number back; the
 * caller lands the activity in its chronological slot and confirms with a
 * toast that offers Undo.
 *
 * A bottom sheet on phones, a centered floating panel on desktop.
 */
import { useLocale, useTranslations } from "next-intl";
import BottomSheet from "@/components/ui/BottomSheet";

export interface MoveToDayOption {
  dayNumber: number;
  /** ISO date (YYYY-MM-DD) — shown as a localized weekday + date when present. */
  date?: string;
  /** Multi-city trips: the city this day is in. */
  city?: string;
  /** Activities already on that day; omitted when the caller doesn't know. */
  count?: number;
}

interface MoveToDaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  activityName: string;
  days: MoveToDayOption[];
  currentDayNumber: number;
  onPick: (dayNumber: number) => void;
}

/** "Fri 12 Sep" in the viewer's locale. Noon avoids timezone date shifts. */
export function formatDayDate(date: string | undefined, locale: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d);
}

export default function MoveToDaySheet({
  isOpen,
  onClose,
  activityName,
  days,
  currentDayNumber,
  onPick,
}: MoveToDaySheetProps) {
  const t = useTranslations("trips");
  const locale = useLocale();

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t("editActivity.moveSheetTitle")} desktopCentered>
      <div className="px-4 pb-4">
        <p className="mb-3 truncate text-sm text-slate-500" title={activityName}>
          {activityName}
        </p>
        <ul className="flex flex-col gap-1.5" data-testid="move-to-day-list">
          {days.map((d) => {
            const isCurrent = d.dayNumber === currentDayNumber;
            const date = formatDayDate(d.date, locale);
            const countLabel =
              d.count === undefined
                ? null
                : d.count === 0
                  ? t("editActivity.emptyDay")
                  : t("editActivity.activityCount", { count: d.count });
            const meta = [date, countLabel].filter(Boolean).join(" · ");
            return (
              <li key={d.dayNumber}>
                <button
                  type="button"
                  disabled={isCurrent}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => onPick(d.dayNumber)}
                  data-testid={`move-to-day-${d.dayNumber}`}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isCurrent
                      ? "cursor-not-allowed border-slate-200 bg-slate-50"
                      : "border-slate-200 bg-white hover:border-[var(--primary)] hover:bg-slate-50 active:bg-slate-100"
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      isCurrent ? "bg-slate-200 text-slate-500" : "bg-[var(--primary)] text-white"
                    }`}
                    aria-hidden="true"
                  >
                    {d.dayNumber}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${isCurrent ? "text-slate-500" : "text-slate-900"}`}>
                      {t("day.label", { number: d.dayNumber })}
                      {d.city ? ` · ${d.city}` : ""}
                    </span>
                    <span className="block text-xs text-slate-500">{meta}</span>
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {t("editActivity.currentDay")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </BottomSheet>
  );
}
