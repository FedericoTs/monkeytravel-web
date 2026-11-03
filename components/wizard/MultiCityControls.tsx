"use client";

import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { tripSpanDays } from "@/lib/dates/iso-date";
import { MultiCityRouteBuilder, type RouteStop } from "@/components/trips/MultiCityRouteBuilder";

/**
 * Above step 1's destination field: the route builder while multi-city is
 * on, or, on a long single-city trip, a one-tap offer to split it into
 * cities.
 */
export function MultiCityRoute({
  multiCityMode,
  setMultiCityMode,
  startDate,
  endDate,
  cityRows,
  setCityRows,
}: {
  multiCityMode: boolean;
  setMultiCityMode: (on: boolean) => void;
  startDate: string;
  endDate: string;
  cityRows: RouteStop[];
  setCityRows: (rows: RouteStop[]) => void;
}) {
  const t = useTranslations("trips");
  return (
    <>
      {/* 12+-day single-city sessions are usually multi-city trips the
          input didn't invite. One tap converts them. */}
      {!multiCityMode &&
        startDate &&
        endDate &&
        tripSpanDays(startDate, endDate) >= 12 && (
          <button
            type="button"
            onClick={() => setMultiCityMode(true)}
            className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            {t("wizard.multiCity.longTripNudge", {
              days: tripSpanDays(startDate, endDate),
            })}
          </button>
        )}

      {/* Multi-city route builder — replaces the single destination field */}
      {multiCityMode && (
        <div>
          <div className="text-sm font-medium text-slate-700 mb-2">
            {t("wizard.multiCity.routeLabel")}
          </div>
          <MultiCityRouteBuilder rows={cityRows} onChange={setCityRows} />
        </div>
      )}
    </>
  );
}

/** The switch that turns multi-city on and off, below the destination field. */
export function MultiCityToggle({
  multiCityMode,
  setMultiCityMode,
}: {
  multiCityMode: boolean;
  setMultiCityMode: Dispatch<SetStateAction<boolean>>;
}) {
  const t = useTranslations("trips");
  return (
    <div
      className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--primary)]/15 bg-[var(--background-warm)] px-4 py-3"
    >
      <div>
        <div className="text-sm font-medium text-slate-800">
          {t("wizard.multiCity.toggleTitle")}
        </div>
        <div className="text-xs text-slate-500">
          {t("wizard.multiCity.toggleDescription")}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={multiCityMode}
        aria-label={t("wizard.multiCity.toggleAria")}
        onClick={() => setMultiCityMode((m) => !m)}
        className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${
          multiCityMode ? "bg-[var(--primary)]" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            multiCityMode ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
