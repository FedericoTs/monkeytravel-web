"use client";

import { useState, useEffect } from "react";
import { useCurrency } from "@/lib/locale";
/* eslint-disable @next/next/no-img-element */

interface DestinationData {
  placeId: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number };
  coverImageUrl: string | null;
  galleryPhotos: { url: string; thumbnailUrl: string }[];
  description?: string;
}

interface DestinationHeroProps {
  destination: string;
  title: string;
  subtitle?: string;
  dateRange?: string;
  budget?: { total: number; currency: string };
  days?: number;
  nights?: number;
  activitiesCount?: number;
  weatherNote?: string;
  highlights?: string[];
  tags?: string[];
  showBackButton?: boolean;
  onBack?: () => void;
  children?: React.ReactNode;
  /** Pre-fetched cover image URL from saved trip - skips Places API call */
  coverImageUrl?: string | null;
  /** Callback to persist cover image after first fetch (optional) */
  onCoverImageFetched?: (imageUrl: string) => void;
}

// Weather parsing - extracts condition and optional temperature
function parseWeatherNote(weather: string): { condition: string; temp?: string; icon: string; gradient: string } {
  const lowerWeather = weather.toLowerCase();

  // Try to extract temperature (e.g., "20-25°C" or "68°F")
  const tempMatch = weather.match(/(\d+[-–]\d+°[CF]|\d+°[CF])/);
  const temp = tempMatch ? tempMatch[1] : undefined;

  // Determine condition and styling - Fresh Voyager theme colors
  if (lowerWeather.includes("sun") || lowerWeather.includes("clear") || lowerWeather.includes("warm") || lowerWeather.includes("hot")) {
    return { condition: "Sunny", temp, icon: "☀️", gradient: "from-[#FF6B6B] to-[#FFB4B4]" };
  }
  if (lowerWeather.includes("cloud") || lowerWeather.includes("overcast")) {
    return { condition: "Cloudy", temp, icon: "☁️", gradient: "from-slate-400 to-slate-500" };
  }
  if (lowerWeather.includes("rain") || lowerWeather.includes("shower")) {
    return { condition: "Rainy", temp, icon: "🌧️", gradient: "from-[#00B4A6] to-[#008B80]" };
  }
  if (lowerWeather.includes("snow") || lowerWeather.includes("cold") || lowerWeather.includes("winter")) {
    return { condition: "Cold", temp, icon: "❄️", gradient: "from-[#74B9FF] to-[#0984e3]" };
  }
  if (lowerWeather.includes("wind")) {
    return { condition: "Windy", temp, icon: "💨", gradient: "from-slate-300 to-slate-500" };
  }
  if (lowerWeather.includes("mild") || lowerWeather.includes("pleasant")) {
    return { condition: "Pleasant", temp, icon: "🌤️", gradient: "from-[#FFD93D] to-[#E5C235]" };
  }
  // Default
  return { condition: "Mild", temp, icon: "🌤️", gradient: "from-[#00B4A6] to-[#55EFC4]" };
}

// Minimal Weather Chip - integrates with meta info chips
function WeatherChip({ weatherNote }: { weatherNote: string }) {
  const weather = parseWeatherNote(weatherNote);

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
      <span className="text-sm sm:text-base">{weather.icon}</span>
      <span className="text-white/90">
        {weather.temp || weather.condition}
      </span>
    </div>
  );
}

export default function DestinationHero({
  destination,
  title,
  subtitle,
  dateRange,
  budget,
  days,
  nights,
  activitiesCount,
  weatherNote,
  highlights,
  tags,
  showBackButton = true,
  onBack,
  children,
  coverImageUrl,
  onCoverImageFetched,
}: DestinationHeroProps) {
  const [destinationData, setDestinationData] = useState<DestinationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Currency conversion hook - converts to user's preferred currency
  const { convert: convertCurrency } = useCurrency();

  // Format budget with currency conversion
  const formatBudget = (amount: number, fromCurrency: string): string => {
    const converted = convertCurrency(amount, fromCurrency);
    return converted.formatted;
  };

  useEffect(() => {
    // If we already have a saved cover image, use it directly - NO API call
    if (coverImageUrl) {
      setDestinationData({
        placeId: "",
        name: destination,
        address: "",
        location: { latitude: 0, longitude: 0 },
        coverImageUrl,
        galleryPhotos: [],
      });
      setLoading(false);
      return;
    }

    const fetchDestination = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/places?destination=${encodeURIComponent(destination)}`
        );
        if (response.ok) {
          const data = await response.json();
          setDestinationData(data);
          // Callback to save the fetched image URL for future use
          if (data.coverImageUrl && onCoverImageFetched) {
            onCoverImageFetched(data.coverImageUrl);
          }
        }
      } catch (error) {
        console.error("Failed to fetch destination:", error);
      } finally {
        setLoading(false);
      }
    };

    if (destination) {
      fetchDestination();
    }
  }, [destination, coverImageUrl, onCoverImageFetched]);

  return (
    <div className="relative">
      {/* Hero Image Container */}
      <div className="relative h-64 md:h-80 lg:h-96 overflow-hidden">
        {/* Background Image */}
        {destinationData?.coverImageUrl ? (
          <>
            <img
              src={destinationData.coverImageUrl}
              alt={destination}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setImageLoaded(true)}
            />
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
          </>
        ) : (
          /* Fallback gradient */
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80" />
        )}

        {/* Loading shimmer */}
        {loading && !destinationData && (
          <div className="absolute inset-0 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse" />
        )}


        {/* Content */}
        <div className="absolute inset-0 flex flex-col justify-end">
          <div className="max-w-4xl mx-auto w-full px-4 pb-6">
            {/* Back button */}
            {showBackButton && onBack && (
              <button
                onClick={onBack}
                className="absolute top-4 left-4 flex items-center gap-2 text-white/90 hover:text-white transition-colors bg-black/20 hover:bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-full"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            {/* Title Section */}
            <div className="text-white">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-2 drop-shadow-lg leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-white/80 text-sm sm:text-base md:text-lg mb-3 sm:mb-4 drop-shadow-md max-w-2xl line-clamp-2 sm:line-clamp-none">
                  {subtitle}
                </p>
              )}

              {/* Meta info chips - Trip stats */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                {/* Date Range */}
                {dateRange && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="truncate max-w-[120px] sm:max-w-none">{dateRange}</span>
                  </div>
                )}

                {/* Days & Nights combined */}
                {(days || nights) && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                    </svg>
                    <span>
                      {days && `${days}D`}
                      {days && nights && " · "}
                      {nights && `${nights}N`}
                    </span>
                  </div>
                )}

                {/* Activities count */}
                {activitiesCount && activitiesCount > 0 && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span>{activitiesCount} activities</span>
                  </div>
                )}

                {/* Budget */}
                {budget && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-[var(--accent)]/90 text-slate-900 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full font-medium">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formatBudget(budget.total, budget.currency)}
                  </div>
                )}

                {/* Weather - minimal inline chip */}
                {weatherNote && <WeatherChip weatherNote={weatherNote} />}
              </div>

              {/* Highlights - shown as inline badges on larger screens */}
              {highlights && highlights.length > 0 && (
                <div className="hidden md:flex flex-wrap items-center gap-2 mt-3">
                  <span className="text-white/60 text-xs uppercase tracking-wider">Highlights:</span>
                  {highlights.slice(0, 3).map((highlight, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-white/10 backdrop-blur-sm text-white/90 text-xs rounded-full border border-white/10"
                    >
                      {highlight.length > 40 ? highlight.substring(0, 40) + '...' : highlight}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tags - Below hero */}
      {tags && tags.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 -mt-3 relative z-10">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-white shadow-md text-slate-700 rounded-full text-sm border border-slate-100"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gallery preview - floating cards, hidden on very small screens */}
      {destinationData?.galleryPhotos && destinationData.galleryPhotos.length > 0 && (
        <div className="hidden sm:block max-w-4xl mx-auto px-4 -mt-6 relative z-10">
          <div className="flex gap-2 justify-end">
            {destinationData.galleryPhotos.slice(0, 3).map((photo, idx) => (
              <div
                key={idx}
                className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg overflow-hidden shadow-lg border-2 border-white relative"
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={`${destination} gallery ${idx + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
            {destinationData.galleryPhotos.length > 3 && (
              <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg overflow-hidden shadow-lg border-2 border-white bg-slate-900/80 flex items-center justify-center text-white text-xs sm:text-sm font-medium">
                +{destinationData.galleryPhotos.length - 3}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Optional children (for action buttons, etc.) */}
      {children}
    </div>
  );
}
