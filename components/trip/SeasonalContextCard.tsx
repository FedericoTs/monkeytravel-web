"use client";

import { useEffect, useState } from "react";
import { SeasonalContext, TripVibe } from "@/types";
import {
  buildSeasonalContext,
  SEASON_EMOJI,
  getSeasonalVibeSuggestions,
  SeasonalVibeSuggestion,
} from "@/lib/seasonal";

interface SeasonalContextCardProps {
  destination: string;
  startDate: string;
  endDate: string;
  onVibeSuggestionClick?: (vibeId: TripVibe) => void;
  className?: string;
}

export default function SeasonalContextCard({
  destination,
  startDate,
  endDate,
  onVibeSuggestionClick,
  className = "",
}: SeasonalContextCardProps) {
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);
  const [vibeSuggestions, setVibeSuggestions] = useState<SeasonalVibeSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!destination || !startDate) {
      setSeasonalContext(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Build seasonal context (could be enhanced with geocoding API for latitude)
    const context = buildSeasonalContext(destination, startDate);
    setSeasonalContext(context);

    // Get vibe suggestions based on season and holidays
    const month = new Date(startDate).getMonth() + 1;
    const suggestions = getSeasonalVibeSuggestions(
      context.season,
      context.holidays,
      month
    );
    setVibeSuggestions(suggestions);

    setIsLoading(false);
  }, [destination, startDate]);

  if (isLoading) {
    return (
      <div className={`animate-pulse rounded-xl bg-slate-100 p-4 ${className}`}>
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-3"></div>
        <div className="h-3 bg-slate-200 rounded w-2/3 mb-2"></div>
        <div className="h-3 bg-slate-200 rounded w-1/2"></div>
      </div>
    );
  }

  if (!seasonalContext || !destination || !startDate) {
    return null;
  }

  const formatDateRange = () => {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

    if (end) {
      return `${start.toLocaleDateString("en-US", options)} - ${end.toLocaleDateString("en-US", options)}`;
    }
    return start.toLocaleDateString("en-US", options);
  };

  const getSeasonLabel = () => {
    return seasonalContext.season.charAt(0).toUpperCase() + seasonalContext.season.slice(1);
  };

  const getCrowdBadgeColor = () => {
    switch (seasonalContext.crowdLevel) {
      case "low":
        return "bg-green-100 text-green-700 border-green-200";
      case "moderate":
        return "bg-amber-100 text-amber-700 border-amber-200";
      case "high":
        return "bg-orange-100 text-orange-700 border-orange-200";
      case "peak":
        return "bg-red-100 text-red-700 border-red-200";
    }
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 overflow-hidden ${className}`}
    >
      {/* Header with date and season */}
      <div className="px-4 py-3 bg-gradient-to-r from-slate-100/80 to-white border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{SEASON_EMOJI[seasonalContext.season]}</span>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {getSeasonLabel()} Season
              </div>
              <div className="text-xs text-slate-500">{formatDateRange()}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-1 rounded-full border font-medium ${getCrowdBadgeColor()}`}
            >
              {seasonalContext.crowdLevel === "peak"
                ? "Peak Season"
                : seasonalContext.crowdLevel === "high"
                ? "Busy"
                : seasonalContext.crowdLevel === "moderate"
                ? "Moderate"
                : "Low Season"}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Weather */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-4 h-4 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
              />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-slate-900">Expected Weather</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {seasonalContext.avgTemp.min}°C - {seasonalContext.avgTemp.max}°C
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{seasonalContext.weather}</div>
          </div>
        </div>

        {/* Holidays */}
        {seasonalContext.holidays.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-900">Holidays & Events</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {seasonalContext.holidays.map((holiday) => (
                  <span
                    key={holiday}
                    className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100"
                  >
                    {holiday}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Vibe Suggestions */}
        {vibeSuggestions.length > 0 && onVibeSuggestionClick && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Suggested vibes for this season
            </div>
            <div className="space-y-2">
              {vibeSuggestions.map((suggestion) => (
                <button
                  key={suggestion.vibeId}
                  onClick={() => onVibeSuggestionClick(suggestion.vibeId)}
                  className="w-full flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 hover:border-[var(--primary)] hover:bg-blue-50/50 transition-all text-left group"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900 group-hover:text-[var(--primary)]">
                      {suggestion.vibeId.charAt(0).toUpperCase() +
                        suggestion.vibeId.slice(1).replace("-", " ")}{" "}
                      Vibe
                    </div>
                    <div className="text-xs text-slate-500">{suggestion.reason}</div>
                  </div>
                  <svg
                    className="w-4 h-4 text-slate-400 group-hover:text-[var(--primary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
