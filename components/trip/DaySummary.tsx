"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Route, Clock, Footprints, Car, Bus, TrendingUp, CalendarClock, AlertTriangle } from "lucide-react";
import type { TravelSegment } from "@/lib/hooks/useTravelDistances";
import {
  PACE_BUDGETS,
  isOverpacked,
  normalizePace,
  sumPlannedMinutes,
  type TripPace,
} from "@/lib/trip/pace";

interface DaySummaryProps {
  dayNumber: number;
  segments: TravelSegment[];
  /**
   * The day's activities (P3b feasibility strip). When provided, the strip
   * shows total planned activity time against the pace budget and flags
   * overpacked days. Structural type so callers can pass Activity[] as-is.
   */
  activities?: ReadonlyArray<{ duration_minutes?: number | null }>;
  /** Trip pace; anything unknown/absent (older trips) reads as "moderate". */
  pace?: TripPace | string;
  className?: string;
}

/**
 * Day-level feasibility strip: total travel distance/time + mode breakdown
 * (when travel segments are computed) and planned-activity-time vs the pace
 * budget (when activities are passed). Uses Fresh Voyager theme colors.
 */
export function DaySummary({
  dayNumber,
  segments,
  activities,
  pace,
  className = "",
}: DaySummaryProps) {
  const t = useTranslations("trips");
  const stats = useMemo(() => {
    const totals = segments.reduce(
      (acc, seg) => ({
        distance: acc.distance + seg.distanceMeters,
        duration: acc.duration + seg.durationSeconds,
        walks: acc.walks + (seg.mode === "WALKING" ? 1 : 0),
        drives: acc.drives + (seg.mode === "DRIVING" ? 1 : 0),
        transits: acc.transits + (seg.mode === "TRANSIT" ? 1 : 0),
        walkingDistance: acc.walkingDistance + (seg.mode === "WALKING" ? seg.distanceMeters : 0),
        drivingDistance: acc.drivingDistance + (seg.mode === "DRIVING" ? seg.distanceMeters : 0),
      }),
      {
        distance: 0,
        duration: 0,
        walks: 0,
        drives: 0,
        transits: 0,
        walkingDistance: 0,
        drivingDistance: 0,
      }
    );

    return {
      ...totals,
      distanceText: formatDistance(totals.distance),
      durationText: formatDuration(totals.duration),
      walkingDistanceText: formatDistance(totals.walkingDistance),
      drivingDistanceText: formatDistance(totals.drivingDistance),
    };
  }, [segments]);

  const feasibility = useMemo(() => {
    const plannedMinutes = sumPlannedMinutes(activities);
    if (plannedMinutes === 0) return null;
    const normalizedPace = normalizePace(pace);
    return {
      plannedText: formatMinutes(plannedMinutes),
      budgetText: formatMinutes(PACE_BUDGETS[normalizedPace].maxActivityMinutes),
      overpacked: isOverpacked(activities, normalizedPace),
    };
  }, [activities, pace]);

  // Don't render if there's neither travel data nor planned time to show
  if (segments.length === 0 && !feasibility) {
    return null;
  }

  return (
    <div
      className={`
        flex flex-wrap items-center gap-3 px-4 py-3
        bg-gradient-to-r from-slate-50/80 to-slate-100/50
        border border-slate-200/60 rounded-xl
        backdrop-blur-sm
        ${className}
      `}
    >
      {/* Icon and label */}
      <div className="flex items-center gap-1.5">
        <TrendingUp className="w-4 h-4 text-[var(--primary-ink)]" />
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {t("daySummary.title", { day: dayNumber })}
        </span>
      </div>

      {/* Planned activity time vs pace budget */}
      {feasibility && (
        <>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-1.5 text-sm">
            <CalendarClock className="w-4 h-4 text-[var(--secondary-ink)]" />
            <span className="font-semibold text-slate-700">
              {t("daySummary.planned", { time: feasibility.plannedText })}
            </span>
            <span className="text-xs text-slate-500">
              {t("daySummary.ofBudget", { time: feasibility.budgetText })}
            </span>
          </div>
          {feasibility.overpacked && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/70">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-xs font-medium text-amber-700">
                {t("daySummary.overpacked")}
              </span>
            </div>
          )}
        </>
      )}

      {segments.length > 0 && (
        <>
          <div className="h-4 w-px bg-slate-200" />

          {/* Total distance */}
          <div className="flex items-center gap-1.5 text-sm">
            <Route className="w-4 h-4 text-[var(--secondary-ink)]" />
            <span className="font-semibold text-slate-700">{stats.distanceText}</span>
          </div>

          <div className="h-4 w-px bg-slate-200" />

          {/* Total travel time */}
          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="w-4 h-4 text-[var(--primary-ink)]" />
            <span className="font-semibold text-slate-700">~{stats.durationText}</span>
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          {/* Mode breakdown */}
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {stats.walks > 0 && (
              <div className="flex items-center gap-1">
                <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-50">
                  <Footprints className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-medium text-emerald-700">{stats.walks}x</span>
                </div>
                <span className="text-slate-500">{stats.walkingDistanceText}</span>
              </div>
            )}
            {stats.drives > 0 && (
              <div className="flex items-center gap-1">
                <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-blue-50">
                  <Car className="w-3.5 h-3.5 text-blue-600" />
                  <span className="font-medium text-blue-700">{stats.drives}x</span>
                </div>
                <span className="text-slate-500">{stats.drivingDistanceText}</span>
              </div>
            )}
            {stats.transits > 0 && (
              <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-purple-50">
                <Bus className="w-3.5 h-3.5 text-purple-600" />
                <span className="font-medium text-purple-700">{stats.transits}x</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Format distance in meters to human readable string
 */
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format duration in seconds to human readable string
 */
function formatDuration(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60));
}

/**
 * Format a minute count to human readable string ("5h 30m", "45 min")
 */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes} min`;
}

export default DaySummary;
