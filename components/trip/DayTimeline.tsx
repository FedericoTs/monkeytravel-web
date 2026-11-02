"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Activity, ItineraryDay } from "@/types";
import type { DayTravelData } from "@/hooks/useTravelDistances";
import type { TripPace } from "@/lib/trip/pace";
import { useActivityPrice } from "@/lib/i18n/activity-price";
import { useActivityTypeLabel } from "@/lib/i18n/activity-type";
import { activityDomId } from "@/lib/trip/activity-dom-id";
import TravelConnector from "./TravelConnector";
import DaySummary from "./DaySummary";

/**
 * A day as a timeline, the alternative to the cards on the wizard's result,
 * the shared trip, the template preview and the trip page: a dot per activity
 * with its time, name (pinned when it is a fixed plan), description, place,
 * price and type, a compact travel leg to the next one, then the day's travel
 * and feasibility summary. Each row carries the activity's DOM id, which a map
 * pin's "View details" scrolls to.
 *
 * Prices are in the viewer's currency; `currency` is the trip's, for an
 * estimate that names none.
 * `extra` adds what a page shows under an activity, such as its votes.
 */
export function DayTimeline({
  day,
  travel,
  travelLoading,
  pace,
  currency,
  extra,
}: {
  day: ItineraryDay;
  travel: DayTravelData | undefined;
  travelLoading: boolean;
  pace: TripPace | string | undefined;
  currency: string;
  extra?: (activity: Activity) => ReactNode;
}) {
  const t = useTranslations("common");
  const typeLabel = useActivityTypeLabel();
  const priceOf = useActivityPrice();
  return (
    <>
      <div className="relative pl-8 border-l-2 border-slate-200 space-y-2">
        {day.activities.map((activity, idx) => {
          const nextActivity = day.activities[idx + 1];
          const segment = nextActivity && travel?.segments.find(
            (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
          );

          return (
            <div key={activity.id || idx}>
              <div id={activityDomId(activity)} className="relative scroll-mt-24">
                {/* Timeline dot */}
                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[var(--primary)] border-4 border-white shadow" />

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                        <span className="font-medium">{activity.start_time}</span>
                        {activity.duration_minutes > 0 && (
                          <>
                            <span>·</span>
                            <span>{activity.duration_minutes} min</span>
                          </>
                        )}
                      </div>
                      <h4 className="font-semibold text-slate-900">
                        {activity.locked && (
                          <span className="mr-1" title={t("lockedActivity")} aria-label={t("lockedActivity")}>
                            📌
                          </span>
                        )}
                        {activity.name}
                      </h4>
                      <p className="text-sm text-slate-600 mt-1">
                        {activity.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {activity.address || activity.location}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-slate-900">
                        {priceOf(activity, currency)}
                      </div>
                      <span className="text-xs text-slate-500 capitalize">
                        {typeLabel(activity.type)}
                      </span>
                    </div>
                  </div>
                  {extra?.(activity)}
                </div>
              </div>
              {/* Compact travel connector */}
              {idx < day.activities.length - 1 && (
                <TravelConnector
                  distanceMeters={segment?.distanceMeters}
                  durationSeconds={segment?.durationSeconds}
                  distanceText={segment?.distanceText}
                  durationText={segment?.durationText}
                  mode={segment?.mode}
                  isLoading={travelLoading || travel?.isLoading}
                  compact={true}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Day travel + feasibility summary */}
      <DaySummary
        dayNumber={day.day_number}
        segments={travel?.segments ?? []}
        activities={day.activities}
        pace={pace}
        className="mt-4"
      />
    </>
  );
}
