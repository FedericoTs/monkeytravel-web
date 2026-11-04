"use client";

import type { ReactNode } from "react";
import type { Activity, ItineraryDay, TripPace } from "@/types";
import { segmentBetween, type DayTravelData } from "@/hooks/useTravelDistances";
import { showsDayBudget } from "@/lib/trip/day-budget";
import ActivityCard from "@/components/ActivityCard";
import DaySlider from "@/components/ui/DaySlider";
import DayHeader, { DayBudget } from "./DayHeader";
import TravelConnector from "./TravelConnector";
import DaySummary from "./DaySummary";
import { DayTimeline } from "./DayTimeline";

interface ReadOnlyItineraryProps {
  days: ItineraryDay[];
  selectedDay: number | null;
  onSelectDay: (dayNumber: number | null) => void;
  viewMode: "cards" | "timeline";
  travelData: Map<number, DayTravelData>;
  travelLoading: boolean;
  /** The trip's own currency; the cards leave prices unconverted without one. */
  currency: string | undefined;
  /** The timeline's currency when the trip has none. */
  fallbackCurrency: string;
  pace: TripPace | string | undefined;
  dayTitle: (day: ItineraryDay) => string;
  budgetLabel: string;
  formatDayBudget: (day: ItineraryDay) => string;
  emptyTitle: string;
  emptyMessage: string;
  /** What the page shows under each activity, such as its votes. */
  activityExtra?: (activity: Activity) => ReactNode;
}

/**
 * A trip's days for reading: the day picker, then each shown day as activity
 * cards or a timeline. The shared-link view and the template preview use it.
 */
export default function ReadOnlyItinerary({
  days,
  selectedDay,
  onSelectDay,
  viewMode,
  travelData,
  travelLoading,
  currency,
  fallbackCurrency,
  pace,
  dayTitle,
  budgetLabel,
  formatDayBudget,
  emptyTitle,
  emptyMessage,
  activityExtra,
}: ReadOnlyItineraryProps) {
  return (
    <>
      <DaySlider days={days} selectedDay={selectedDay} onSelectDay={onSelectDay} className="mb-6" />

      {days.length > 0 ? (
        <div className="space-y-8">
          {days
            .filter((day) => selectedDay === null || day.day_number === selectedDay)
            .map((day) => (
              <div key={day.day_number}>
                <DayHeader dayNumber={day.day_number} title={dayTitle(day)} theme={day.theme}>
                  {showsDayBudget(day) && <DayBudget label={budgetLabel} value={formatDayBudget(day)} />}
                </DayHeader>

                {viewMode === "cards" ? (
                  <>
                    <div className="grid gap-0">
                      {day.activities.map((activity, idx) => {
                        const dayTravelData = travelData.get(day.day_number);
                        const segment = segmentBetween(dayTravelData, activity, day.activities[idx + 1]);
                        const extra = activityExtra?.(activity);
                        return (
                          <div key={activity.id || idx}>
                            <ActivityCard
                              activity={activity}
                              index={idx}
                              currency={currency}
                              showGallery={true}
                              disableAutoFetch={true}
                            />
                            {extra ? <div className="px-3 sm:px-4 pb-3">{extra}</div> : null}
                            {idx < day.activities.length - 1 && (
                              <TravelConnector segment={segment} isLoading={travelLoading || dayTravelData?.isLoading} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <DaySummary
                      dayNumber={day.day_number}
                      segments={travelData.get(day.day_number)?.segments ?? []}
                      activities={day.activities}
                      pace={pace}
                      className="mt-4"
                    />
                  </>
                ) : (
                  <DayTimeline
                    day={day}
                    travel={travelData.get(day.day_number)}
                    travelLoading={travelLoading}
                    pace={pace}
                    currency={currency || fallbackCurrency}
                    extra={
                      activityExtra &&
                      ((activity) => {
                        const extra = activityExtra(activity);
                        return extra ? <div className="mt-3">{extra}</div> : null;
                      })
                    }
                  />
                )}
              </div>
            ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <h3 className="text-lg font-medium text-slate-900 mb-2">{emptyTitle}</h3>
          <p className="text-slate-600">{emptyMessage}</p>
        </div>
      )}
    </>
  );
}
