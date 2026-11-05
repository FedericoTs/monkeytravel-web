"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale as useNextIntlLocale } from "next-intl";
import { sentryException } from "@/lib/observability/sentry";
import { SeasonalContext } from "@/types";
import {
  buildSeasonalContext,
  SEASON_EMOJI,
  getSeasonalVibeSuggestions,
  SeasonalVibeSuggestion,
} from "@/lib/seasonal";
import { useLocale, formatTemperatureRange } from "@/lib/locale";
import { isPlausibleTripRange } from "@/lib/dates/iso-date";
import { formatDateRange } from "@/lib/datetime";

// The seasonal lib emits English `reason` strings (it's a pure-data lib with
// no i18n coupling). We map those well-known strings back to translation keys
// so the displayed tooltip respects the active locale. Mirrors the same
// pattern used elsewhere when localizing strings produced by data-only libs.
const VIBE_REASON_KEY_BY_ENGLISH: Record<string, string> = {
  "Perfect for Christmas markets and winter wonderland vibes": "christmas",
  "Experience local festivals and celebrations": "festival",
  "Ideal for romantic getaways": "valentine",
  "Cherry blossoms and spring blooms await": "spring",
  "Great weather for outdoor activities": "summer",
  "Harvest season with amazing local produce": "autumnFoodie",
  "Cozy vintage cafes and autumn colors": "autumnRetro",
  "Perfect for spa retreats and cozy escapes": "winter",
};

// One weather request per settled edit, not one per keystroke. The day digits
// of a valid date are valid dates too (2026-10-03 on the way to 2026-10-30);
// the plausibility guard in the effect only removes the impossible ones.
const WEATHER_FETCH_DEBOUNCE_MS = 400;

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
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // Get user's temperature preference (Celsius or Fahrenheit)
  const { preferences } = useLocale();
  // next-intl translator + active locale for date formatting.
  const t = useTranslations("trips.seasonalContext");
  const tVibes = useTranslations("common.vibes.types");
  const locale = useNextIntlLocale();

  // Fetch weather data from API.
  // Wizard date edits fire rapid useEffect runs — without an AbortController,
  // out-of-order responses race and stale temps land in state. Mirror the
  // usual pattern: abort the in-flight request
  // on cleanup, then short-circuit any post-cleanup setState via a cancelled
  // flag (covers the window between the response arriving and aborted being
  // observable).
  const hasWeatherRange = Boolean(coordinates && startDate && endDate);
  if (!hasWeatherRange && weatherData) setWeatherData(null);

  useEffect(() => {
    if (!coordinates || !startDate || !endDate) return;
    // Partial years ("0201-10-30") and reversed ranges are what the date
    // fields report mid-edit. They are not a forecast request: skip them and
    // keep whatever is on screen, so the card does not flicker while someone
    // types the year.
    if (!isPlausibleTripRange(startDate, endDate)) return;

    const controller = new AbortController();
    let cancelled = false;

    const fetchWeather = async () => {
      setWeatherLoading(true);
      try {
        const params = new URLSearchParams({
          latitude: coordinates.latitude.toString(),
          longitude: coordinates.longitude.toString(),
          startDate,
          endDate,
        });
        const response = await fetch(`/api/weather?${params}`, {
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;
        if (response.ok) {
          const data = await response.json();
          if (cancelled || controller.signal.aborted) return;
          setWeatherData(data.weather);
        }
      } catch (error) {
        // AbortError fires when a newer fetch supersedes this one — expected,
        // don't report. Anything else is a real failure: log + breadcrumb to
        // Sentry so we catch silent weather outages in production.
        const isAbort = error instanceof Error && error.name === "AbortError";
        if (isAbort || cancelled || controller.signal.aborted) return;
        console.error("Failed to fetch weather:", error);
        sentryException(error, {
          tags: { component: "SeasonalContextCard", endpoint: "/api/weather" },
        });
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setWeatherLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchWeather, WEATHER_FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [coordinates, startDate, endDate]);

  const { seasonalContext, vibeSuggestions } = useMemo<{
    seasonalContext: SeasonalContext | null;
    vibeSuggestions: SeasonalVibeSuggestion[];
  }>(() => {
    if (!destination || !startDate) return { seasonalContext: null, vibeSuggestions: [] };

    // Build seasonal context with latitude for accurate hemisphere detection.
    // endDate keeps the holidays to the ones inside the trip.
    const context = buildSeasonalContext(
      destination,
      startDate,
      coordinates?.latitude, // Pass latitude for correct hemisphere (fixes Southern Hemisphere bug)
      endDate || undefined
    );

    // Get vibe suggestions based on season and holidays.
    // Parse YYYY-MM-DD as local: `new Date(iso)` is UTC midnight, which west
    // of UTC is the day before, so the 1st would count in the previous month.
    const localStart = (() => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
      if (!m) return new Date(startDate);
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    })();
    const month = localStart.getMonth() + 1;
    const suggestions = getSeasonalVibeSuggestions(
      context.season,
      context.holidays,
      month
    );
    return { seasonalContext: context, vibeSuggestions: suggestions };
  }, [destination, startDate, endDate, coordinates]);

  if (!seasonalContext || !destination || !startDate) {
    return null;
  }

  const getSeasonLabel = () => {
    // "Spring Season" / "Stagione Primavera" / "Temporada de Primavera"
    return t("seasonLabel", { season: t(`seasons.${seasonalContext.season}`) });
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
                {getSeasonLabel()}
              </div>
              <div className="text-xs text-slate-500">{formatDateRange(startDate, endDate || startDate, locale)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-1 rounded-full border font-medium ${getCrowdBadgeColor()}`}
            >
              {t(`crowd.${seasonalContext.crowdLevel}`)}
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
              <div className="text-sm font-semibold text-slate-900">{t("expectedWeather")}</div>
              {weatherData && (
                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                  {t("liveData")}
                </span>
              )}
            </div>
            {weatherData ? (
              <>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold text-slate-800">
                    {formatTemperatureRange(weatherData.temperature.min, weatherData.temperature.max, preferences.temperatureUnit)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{weatherData.conditions}</div>
                {weatherData.precipitation.rainyDays > 0 && (
                  <div className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                    {t("rainyDays", { count: weatherData.precipitation.rainyDays })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatTemperatureRange(seasonalContext.avgTemp.min, seasonalContext.avgTemp.max, preferences.temperatureUnit)}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {/* Localize the fallback weather sentence. The seasonal lib
                      returns English text keyed off (season, hemisphere); we
                      reconstruct the same key here. Temperature ranges are
                      stripped from the translated copy since formatTemperatureRange
                      already renders the locale-aware number above. */}
                  {(() => {
                    if (seasonalContext.hemisphere === "tropical") {
                      return t(
                        seasonalContext.season === "summer"
                          ? "weatherFallback.tropicalWet"
                          : "weatherFallback.tropicalDry"
                      );
                    }
                    return t(`weatherFallback.${seasonalContext.season}`);
                  })()}
                </div>
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
              <div className="text-sm font-medium text-slate-900">{t("holidaysAndEvents")}</div>
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
              {t("suggestedVibes")}
            </div>
            <div className="flex flex-wrap gap-2">
              {vibeSuggestions.map((suggestion) => {
                // Reuse the canonical localized vibe label from common.vibes.types
                // (the same labels the wizard chip-picker shows) instead of
                // building a label from the raw vibeId. Fallback to a humanized
                // vibeId if the catalog ever drifts ahead of translations.
                let vibeLabel: string;
                try {
                  vibeLabel = tVibes(`${suggestion.vibeId}.label`);
                } catch {
                  vibeLabel =
                    suggestion.vibeId.charAt(0).toUpperCase() +
                    suggestion.vibeId.slice(1).replace("-", " ");
                }
                const reasonKey = VIBE_REASON_KEY_BY_ENGLISH[suggestion.reason];
                const reasonText = reasonKey
                  ? t(`vibeReasons.${reasonKey}`)
                  : suggestion.reason; // safety net for future reasons
                return (
                  <div
                    key={suggestion.vibeId}
                    className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-100 cursor-default"
                  >
                    <span className="text-sm font-medium text-purple-700">{vibeLabel}</span>
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {reasonText}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 italic">
              {t("vibesHint")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
