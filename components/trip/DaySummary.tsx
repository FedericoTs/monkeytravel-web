"use client";

import { useMemo } from "react";
import { Route, Clock, Footprints, Car, Bus, TrendingUp } from "lucide-react";
import type { TravelSegment } from "@/lib/hooks/useTravelDistances";

interface DaySummaryProps {
  dayNumber: number;
  segments: TravelSegment[];
  className?: string;
}

/**
 * Day-level travel summary showing total distance, time, and mode breakdown
 * Uses Fresh Voyager theme colors
 */
export function DaySummary({
  dayNumber,
  segments,
  className = "",
}: DaySummaryProps) {
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

  // Don't render if no segments
  if (segments.length === 0) {
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
        <TrendingUp className="w-4 h-4 text-[var(--primary)]" />
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Day {dayNumber} Travel
        </span>
      </div>

      <div className="h-4 w-px bg-slate-200" />

      {/* Total distance */}
      <div className="flex items-center gap-1.5 text-sm">
        <Route className="w-4 h-4 text-[var(--secondary)]" />
        <span className="font-semibold text-slate-700">{stats.distanceText}</span>
      </div>

      <div className="h-4 w-px bg-slate-200" />

      {/* Total travel time */}
      <div className="flex items-center gap-1.5 text-sm">
        <Clock className="w-4 h-4 text-[var(--primary)]" />
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
            <span className="text-slate-400">{stats.walkingDistanceText}</span>
          </div>
        )}
        {stats.drives > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-blue-50">
              <Car className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-medium text-blue-700">{stats.drives}x</span>
            </div>
            <span className="text-slate-400">{stats.drivingDistanceText}</span>
          </div>
        )}
        {stats.transits > 0 && (
          <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-purple-50">
            <Bus className="w-3.5 h-3.5 text-purple-600" />
            <span className="font-medium text-purple-700">{stats.transits}x</span>
          </div>
        )}
      </div>
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
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes} min`;
}

export default DaySummary;
