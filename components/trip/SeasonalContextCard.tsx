"use client";

import { useEffect, useState } from "react";
import { SeasonalContext } from "@/types";
import {
  buildSeasonalContext,
  SEASON_EMOJI,
  getSeasonalVibeSuggestions,
  SeasonalVibeSuggestion,
} from "@/lib/seasonal";

interface WeatherData {
  temperature: {
    min: number;
    max: number;
    avg: number;
  };
  precipitation: {
    totalMm: number;
    rainyDays: number;
  };
  conditions: string;
  humidity: number;
  icon: string;
}

interface SeasonalContextCardProps {
  destination: string;
  startDate: string;
  endDate: string;
  coordinates?: { latitude: number; longitude: number };
  className?: string;
}

export default function SeasonalContextCard({
  destination,
  startDate,
  endDate,
  coordinates,
  className = "",
}: SeasonalContextCardProps) {
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);
  const [vibeSuggestions, setVibeSuggestions] = useState<SeasonalVibeSuggestion[]>([]);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // Fetch weather data from API
  useEffect(() => {
    if (!coordinates || !startDate || !endDate) {
      setWeatherData(null);
      return;
    }

    const fetchWeather = async () => {
      setWeatherLoading(true);
      try {
        const params = new URLSearchParams({
          latitude: coordinates.latitude.toString(),
          longitude: coordinates.longitude.toString(),
          startDate,
          endDate,
        });
        const response = await fetch(`/api/weather?${params}`);
        if (response.ok) {
          const data = await response.json();
          setWeatherData(data.weather);
        }
      } catch (error) {
        console.error("Failed to fetch weather:", error);
      } finally {
        setWeatherLoading(false);
      }
    };

    fetchWeather();
  }, [coordinates, startDate, endDate]);

  useEffect(() => {
    if (!destination || !startDate) {
      setSeasonalContext(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Build seasonal context with latitude for accurate hemisphere detection
    const context = buildSeasonalContext(
      destination,
      startDate,
      coordinates?.latitude // Pass latitude for correct hemisphere (fixes Southern Hemisphere bug)
    );
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
  }, [destination, startDate, coordinates]);

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
        {/* Weather - Uses API data when available */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-sky-50 flex items-center justify-center flex-shrink-0 text-xl">
            {weatherLoading ? (
              <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
            ) : weatherData ? (
              weatherData.icon
            ) : (
              <svg
                className="w-5 h-5 text-blue-600"
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
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">Expected Weather</div>
              {weatherData && (
                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                  Live Data
                </span>
              )}
            </div>
            {weatherData ? (
              <>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold text-slate-800">
                    {weatherData.temperature.min}°C – {weatherData.temperature.max}°C
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{weatherData.conditions}</div>
                {weatherData.precipitation.rainyDays > 0 && (
                  <div className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                    ~{weatherData.precipitation.rainyDays} rainy days expected
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-slate-500 mt-0.5">
                  {seasonalContext.avgTemp.min}°C - {seasonalContext.avgTemp.max}°C
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{seasonalContext.weather}</div>
              </>
            )}
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

        {/* Vibe Suggestions - Non-clickable informational chips */}
        {vibeSuggestions.length > 0 && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Suggested vibes for this season
            </div>
            <div className="flex flex-wrap gap-2">
              {vibeSuggestions.map((suggestion) => (
                <div
                  key={suggestion.vibeId}
                  className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-100 cursor-default"
                >
                  <span className="text-sm font-medium text-purple-700">
                    {suggestion.vibeId.charAt(0).toUpperCase() +
                      suggestion.vibeId.slice(1).replace("-", " ")}
                  </span>
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {suggestion.reason}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 italic">
              These are suggestions based on the season. Select your vibes in the next step.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
