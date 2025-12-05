"use client";

import type { TripMeta, ItineraryDay } from "@/types";
import { useCurrency } from "@/lib/locale";

interface TripInfoCardsProps {
  meta: TripMeta;
  itinerary: ItineraryDay[];
  budget?: { total: number; currency: string } | null;
  startDate: string;
  endDate: string;
}

// Weather icon based on weather description
function WeatherIcon({ weather }: { weather: string }) {
  const lowerWeather = weather.toLowerCase();

  if (lowerWeather.includes("sun") || lowerWeather.includes("clear") || lowerWeather.includes("warm")) {
    return (
      <svg className="w-8 h-8 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
      </svg>
    );
  }

  if (lowerWeather.includes("cloud") || lowerWeather.includes("overcast")) {
    return (
      <svg className="w-8 h-8 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
        <path fillRule="evenodd" d="M4.5 9.75a6 6 0 0111.573-2.226 3.75 3.75 0 014.133 4.303A4.5 4.5 0 0118 20.25H6.75a5.25 5.25 0 01-2.23-10.004 6.072 6.072 0 01-.02-.496z" clipRule="evenodd" />
      </svg>
    );
  }

  if (lowerWeather.includes("rain") || lowerWeather.includes("shower")) {
    return (
      <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    );
  }

  if (lowerWeather.includes("snow") || lowerWeather.includes("cold") || lowerWeather.includes("winter")) {
    return (
      <svg className="w-8 h-8 text-cyan-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    );
  }

  // Default - partly cloudy
  return (
    <svg className="w-8 h-8 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0z" />
      <path fillRule="evenodd" d="M5.625 11.25a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h1.875a.75.75 0 01.75.75zm14.25 0a.75.75 0 01-.75.75H18a.75.75 0 010-1.5h1.125a.75.75 0 01.75.75zM6.166 6.166a.75.75 0 010 1.06l-.707.707a.75.75 0 11-1.06-1.06l.707-.707a.75.75 0 011.06 0zm12.728 0a.75.75 0 010 1.06l-.707.707a.75.75 0 11-1.06-1.06l.707-.707a.75.75 0 011.06 0z" clipRule="evenodd" />
    </svg>
  );
}

export default function TripInfoCards({
  meta,
  itinerary,
  budget,
  startDate,
  endDate,
}: TripInfoCardsProps) {
  // Currency conversion hook - converts to user's preferred currency
  const { convert: convertCurrency } = useCurrency();

  // Format budget with currency conversion
  const formatBudget = (amount: number, fromCurrency: string): string => {
    const converted = convertCurrency(amount, fromCurrency);
    return converted.formatted;
  };

  // Calculate stats
  const totalActivities = itinerary.reduce((acc, day) => acc + day.activities.length, 0);
  const tripDays = itinerary.length;

  // Calculate date difference for trip duration
  const start = new Date(startDate);
  const end = new Date(endDate);
  const nights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  // Format dates nicely
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const hasWeather = meta.weather_note && meta.weather_note.length > 0;
  const hasHighlights = meta.highlights && meta.highlights.length > 0;

  if (!hasWeather && !hasHighlights && !budget) {
    return null;
  }

  return (
    <div className="mb-8">
      {/* Section Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Trip Overview</h2>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Weather Card */}
        {hasWeather && (
          <div className="group relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-amber-50 rounded-2xl border border-sky-100 p-5 hover:shadow-lg hover:shadow-sky-100/50 transition-all duration-300">
            {/* Decorative background elements */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-amber-100/40 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-sky-100/40 to-transparent rounded-full translate-y-1/2 -translate-x-1/2" />

            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-sky-600 uppercase tracking-wider mb-1">Weather</div>
                  <div className="text-sm text-slate-600">
                    {formatDate(startDate)} - {formatDate(endDate)}
                  </div>
                </div>
                <WeatherIcon weather={meta.weather_note || ""} />
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">
                {meta.weather_note}
              </p>
            </div>
          </div>
        )}

        {/* Quick Stats Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-teal-50 rounded-2xl border border-emerald-100 p-5 hover:shadow-lg hover:shadow-emerald-100/50 transition-all duration-300">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-teal-100/30 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />

          <div className="relative">
            <div className="text-xs font-medium text-emerald-600 uppercase tracking-wider mb-3">At a Glance</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-900">{tripDays}</div>
                <div className="text-xs text-slate-500">Days</div>
              </div>
              <div className="text-center border-x border-emerald-100">
                <div className="text-2xl font-bold text-slate-900">{nights}</div>
                <div className="text-xs text-slate-500">Nights</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-900">{totalActivities}</div>
                <div className="text-xs text-slate-500">Activities</div>
              </div>
            </div>
            {budget && (
              <div className="mt-4 pt-3 border-t border-emerald-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Est. Budget</span>
                  <span className="text-lg font-semibold text-emerald-700">
                    {formatBudget(budget.total, budget.currency)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Highlights Card */}
        {hasHighlights && (
          <div className="group relative overflow-hidden bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 rounded-2xl border border-violet-100 p-5 hover:shadow-lg hover:shadow-violet-100/50 transition-all duration-300 md:col-span-2 lg:col-span-1">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-28 h-28 bg-gradient-to-bl from-fuchsia-100/30 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />

            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-violet-500" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036a2.63 2.63 0 001.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258a2.63 2.63 0 00-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.63 2.63 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.63 2.63 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z" clipRule="evenodd" />
                </svg>
                <div className="text-xs font-medium text-violet-600 uppercase tracking-wider">Highlights</div>
              </div>
              <ul className="space-y-2">
                {meta.highlights!.slice(0, 4).map((highlight, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 flex-shrink-0" />
                    <span className="leading-relaxed">{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Tags/Best For Section */}
      {meta.destination_best_for && meta.destination_best_for.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider mr-2">Best for:</span>
          {meta.destination_best_for.map((tag, idx) => (
            <span
              key={idx}
              className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-medium rounded-full hover:bg-slate-200 transition-colors"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
