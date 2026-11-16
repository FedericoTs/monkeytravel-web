"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import type { RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import DateRangePicker from "@/components/ui/DateRangePicker";
import { sanitizeIsoDate } from "@/lib/dates/iso-date";
import type { TripWizardFieldInteractedEvent } from "@/lib/posthog/events";
import { localTodayISO } from "@/lib/utils/date-local";

/**
 * Step 1's dates: the range picker, or on a multi-city trip only the start
 * date (the nights per city make the end), and under them the way to
 * flexible dates, or what flexible dates pencilled in.
 */
export default function TripDatesField({
  multiCity,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  maxStartDate,
  cityRows,
  dateTriggerRef,
  trackFieldInteraction,
  flexibleDates,
  setFlexibleDates,
  datesPencilled,
  setDatesPencilled,
  effectiveMaxTripDays,
  handleFlexibleDates,
}: {
  /** A multi-city trip: the route's nights make the end date. */
  multiCity: boolean;
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  /** The latest start date a trip can take (YYYY-MM-DD). */
  maxStartDate: string;
  cityRows: RouteStop[];
  dateTriggerRef: RefObject<HTMLButtonElement | null>;
  trackFieldInteraction: (field: TripWizardFieldInteractedEvent["field"]) => void;
  flexibleDates: boolean;
  setFlexibleDates: (flexible: boolean) => void;
  /** Flexible dates were filled in for the planner, not chosen. */
  datesPencilled: boolean;
  setDatesPencilled: (pencilled: boolean) => void;
  effectiveMaxTripDays: number;
  handleFlexibleDates: () => void;
}) {
  const t = useTranslations("trips");
  return (
    <div>
      <div className="text-sm font-medium text-slate-700 mb-2">{t("wizard.step1.travelDatesLabel")}</div>
      {multiCity ? (
        // Multi-city: trip length = sum of per-city nights, so only the
        // START date is a free choice; the end is derived (sync effect).
        <div>
          <input
            type="date"
            value={startDate}
            min={localTodayISO()}
            // Bounded on BOTH ends. Without a max, a typed year of
            // "20220" is a perfectly acceptable <input type="date">
            // value (the spec allows years to 275760), and in
            // multi-city generation addDaysISO throws on it
            // ("invalid date"): ISO 8601 needs a sign for extended
            // years (+020220-05-01), so new Date() returns NaN.
            max={maxStartDate}
            onChange={(e) => {
              trackFieldInteraction("start_date");
              // max alone is not enough: Chrome still reports an
              // out-of-range-but-parseable date through .value. Accept
              // only a real YYYY-MM-DD, so a malformed year can never
              // reach the itinerary maths.
              setStartDate(sanitizeIsoDate(e.target.value));
            }}
            aria-label={t("wizard.multiCity.startDateAria")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            {t("wizard.multiCity.nightsTotal", { count: cityRows.reduce((s, r) => s + (Number(r.nights) || 0), 0) })}
            {endDate ? ` · ${t("wizard.multiCity.endsOn", { date: endDate })}` : ""}
          </p>
        </div>
      ) : (
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          triggerRef={dateTriggerRef}
          onStartDateChange={(d) => {
            trackFieldInteraction("start_date");
            setFlexibleDates(false);
            setDatesPencilled(false);
            setStartDate(d);
          }}
          onEndDateChange={(d) => {
            trackFieldInteraction("end_date");
            setFlexibleDates(false);
            setDatesPencilled(false);
            setEndDate(d);
          }}
          maxDays={effectiveMaxTripDays}
          minDate={localTodayISO()}
        />
      )}

      {/* "I'm flexible" escape hatch — dates are a hard gate to advance,
          but many visitors know WHERE, not WHEN. One tap fills a sensible
          default (~3 weeks out, 5 days) so they can reach a generated trip
          and fine-tune later. Hidden in multi-city mode (per-city nights
          model owns dates there). */}
      {!multiCity && (
        <div className="mt-2">
          {flexibleDates ? (
            datesPencilled ? (
              // Announced, not just shown: the one-tap moved focus here
              // and this is the sentence that explains what it assumed.
              // slate-600, not coral — --primary-ink is 2.68:1.
              <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-slate-600">
                <svg className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t("wizard.step1.oneTap.datesPencilled", { days: 5 })}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t("wizard.step1.flexibleDatesActive")}
              </p>
            )
          ) : (
            !(startDate && endDate) && (
              <button
                type="button"
                onClick={handleFlexibleDates}
                className="text-xs font-medium text-[var(--foreground)] underline underline-offset-2"
              >
                {t("wizard.step1.flexibleDatesCta")}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
