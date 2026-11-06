"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDuration } from "@/lib/datetime/duration";
import { isOverpacked, normalizePace, PACE_BUDGETS, sumPlannedMinutes } from "@/lib/trip/pace";
import type { TripPace } from "@/types";

/**
 * On the plan page, a day past its pace's budget (lib/trip/pace.ts) says so where
 * the day starts, with one tap to have the assistant lighten it. Other days show
 * nothing: this is a signal, and a line under every day would stop being one.
 */
export function PackedDayNote({
  activities,
  pace,
  onLighten,
  className = "",
}: {
  activities: ReadonlyArray<{ duration_minutes?: number | null }>;
  pace: TripPace | string | undefined;
  onLighten: () => void;
  className?: string;
}) {
  const t = useTranslations("trips");
  const normalized = normalizePace(pace);
  if (!isOverpacked(activities, normalized)) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm ${className}`}>
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <span className="font-semibold text-amber-900">{t("daySummary.overpacked")}</span>
      <span className="text-amber-900">
        {t("daySummary.planned", { time: formatDuration(sumPlannedMinutes(activities)) })}{" "}
        {t("daySummary.ofBudget", { time: formatDuration(PACE_BUDGETS[normalized].maxActivityMinutes) })}
      </span>
      <button
        type="button"
        onClick={onLighten}
        className="ml-auto min-h-[44px] rounded font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 sm:min-h-0"
      >
        {t("daySummary.lighten")}
      </button>
    </div>
  );
}
