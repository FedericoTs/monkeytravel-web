"use client";

import { useState, useEffect, useRef } from "react";
import type { Activity } from "@/types";
import PlaceGallery from "./PlaceGallery";
import ActivityDetailSheet from "./ui/ActivityDetailSheet";

interface VerifiedPriceData {
  priceRange?: string;         // Direct range from Google like "EUR 40-50"
  priceLevel?: number;         // 0-4 price level from Google
  priceLevelSymbol?: string;   // $, $$, $$$, $$$$
  priceLevelLabel?: string;    // "Inexpensive", "Moderate", etc.
}

/**
 * Convert Google's price level (0-4) to an estimated price range.
 * Intentionally overestimates to avoid disappointing users.
 * Ranges are per person for the activity type.
 */
function convertPriceLevelToRange(
  priceLevel: number,
  activityType: string,
  currency: string
): { min: number; max: number } | null {
  // Price ranges by category (intentionally on the higher side)
  const foodTypes = ["restaurant", "food", "cafe", "bar", "foodie", "wine bar"];
  const attractionTypes = ["attraction", "cultural", "museum", "landmark"];
  const wellnessTypes = ["spa", "wellness"];
  const shoppingTypes = ["shopping", "market"];
  const entertainmentTypes = ["entertainment", "nightlife", "event"];

  // Define ranges for each level by category (per person)
  const ranges: Record<string, Record<number, { min: number; max: number }>> = {
    food: {
      0: { min: 0, max: 0 },      // Free
      1: { min: 15, max: 30 },    // $ - Budget
      2: { min: 35, max: 60 },    // $$ - Moderate
      3: { min: 65, max: 110 },   // $$$ - Expensive
      4: { min: 120, max: 220 },  // $$$$ - Very Expensive
    },
    attraction: {
      0: { min: 0, max: 0 },
      1: { min: 10, max: 22 },
      2: { min: 25, max: 50 },
      3: { min: 55, max: 95 },
      4: { min: 100, max: 180 },
    },
    wellness: {
      0: { min: 0, max: 0 },
      1: { min: 45, max: 80 },
      2: { min: 90, max: 160 },
      3: { min: 180, max: 320 },
      4: { min: 350, max: 600 },
    },
    shopping: {
      0: { min: 0, max: 0 },
      1: { min: 25, max: 55 },
      2: { min: 65, max: 130 },
      3: { min: 150, max: 300 },
      4: { min: 350, max: 700 },
    },
    entertainment: {
      0: { min: 0, max: 0 },
      1: { min: 20, max: 45 },
      2: { min: 50, max: 95 },
      3: { min: 110, max: 200 },
      4: { min: 220, max: 450 },
    },
  };

  // Determine category
  let category = "attraction"; // default
  if (foodTypes.includes(activityType)) category = "food";
  else if (wellnessTypes.includes(activityType)) category = "wellness";
  else if (shoppingTypes.includes(activityType)) category = "shopping";
  else if (entertainmentTypes.includes(activityType)) category = "entertainment";
  else if (attractionTypes.includes(activityType)) category = "attraction";

  const levelRanges = ranges[category];
  if (!levelRanges || levelRanges[priceLevel] === undefined) return null;

  return levelRanges[priceLevel];
}

/**
 * Format a price range for display
 */
function formatPriceRange(min: number, max: number, currency: string): string {
  if (min === 0 && max === 0) return "Free";
  // For same values, show single price
  if (min === max) return `${currency} ${min}`;
  return `${currency} ${min}-${max}`;
}

interface ActivityCardProps {
  activity: Activity;
  index: number;
  currency?: string;
  showGallery?: boolean;
}

export default function ActivityCard({
  activity,
  index,
  currency = "USD",
  showGallery = true,
}: ActivityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showMobileSheet, setShowMobileSheet] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [verifiedPrice, setVerifiedPrice] = useState<VerifiedPriceData | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  // Use stable activity key to track what we've fetched (survives re-renders but not remounts)
  const fetchedActivityRef = useRef<string>("");

  // Create stable key from activity properties (not id, since we want to fetch for same place)
  const activityKey = `${activity.name}|${activity.address || activity.location}|${activity.type}`;

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Types that typically have price information in Google Places
  const priceableTypes = [
    "restaurant", "attraction", "food", "cafe", "bar", "foodie",
    "market", "shopping", "cultural", "museum", "landmark",
    "spa", "wellness", "entertainment", "nightlife", "wine bar"
  ];

  // Fetch verified price from Google Places API
  useEffect(() => {
    // Only fetch for types that typically have price info
    if (!priceableTypes.includes(activity.type)) {
      return;
    }

    // Skip if we already fetched for this exact activity
    if (fetchedActivityRef.current === activityKey) {
      return;
    }

    const fetchVerifiedPrice = async () => {
      fetchedActivityRef.current = activityKey;
      setPriceLoading(true);

      try {
        const response = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `${activity.name} ${activity.address || activity.location}`,
            maxPhotos: 1, // We only need price data, minimize photo fetch
          }),
        });

        if (response.ok) {
          const data = await response.json();
          // Store if we have any price info (range, level, or symbol)
          if (data.priceRange || data.priceLevel !== undefined || data.priceLevelSymbol) {
            setVerifiedPrice({
              priceRange: data.priceRange,
              priceLevel: data.priceLevel,
              priceLevelSymbol: data.priceLevelSymbol,
              priceLevelLabel: data.priceLevelLabel,
            });
          }
        }
      } catch (error) {
        // Silently fail - we'll just show AI estimate
        console.error("Failed to fetch verified price:", error);
      } finally {
        setPriceLoading(false);
      }
    };

    fetchVerifiedPrice();
  }, [activityKey, activity.name, activity.address, activity.location, activity.type]);

  // Handle More button click - different behavior for mobile vs desktop
  const handleMoreClick = () => {
    if (isMobile) {
      setShowMobileSheet(true);
    } else {
      setExpanded(!expanded);
    }
  };

  // Generate URLs
  const mapSearchQuery = encodeURIComponent(
    `${activity.name} ${activity.address || activity.location}`
  );
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapSearchQuery}`;
  const googleSearchUrl = `https://www.google.com/search?q=${mapSearchQuery}`;

  const typeColors: Record<string, { bg: string; text: string; border: string }> = {
    // Food & Drink
    restaurant: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    food: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    cafe: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    bar: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    foodie: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    "wine bar": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    // Attractions & Culture
    attraction: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    cultural: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
    museum: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
    landmark: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    // Activities & Nature
    activity: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
    nature: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    park: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    // Shopping & Entertainment
    shopping: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
    market: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
    entertainment: { bg: "bg-fuchsia-50", text: "text-fuchsia-700", border: "border-fuchsia-200" },
    nightlife: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
    // Wellness
    spa: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
    wellness: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
    // Transport & Other
    transport: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
    event: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  };

  const colors = typeColors[activity.type] || { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" };

  return (
    <div
      className={`bg-white rounded-xl border transition-all duration-300 ${
        expanded ? "shadow-lg border-slate-300" : "shadow-sm border-slate-200 hover:shadow-md"
      }`}
    >
      {/* Main Content */}
      <div className="p-3 sm:p-4">
        <div className="flex gap-3 sm:gap-4">
          {/* Time Column - hidden on mobile, shows inline instead */}
          <div className="hidden sm:flex flex-shrink-0 text-center w-16 flex-col">
            <div className="text-lg font-semibold text-slate-900">
              {activity.start_time}
            </div>
            <div className="text-xs text-slate-500">
              {activity.duration_minutes} min
            </div>
            <div
              className={`mt-2 w-8 h-8 mx-auto rounded-full ${colors.bg} ${colors.text} flex items-center justify-center`}
            >
              {activity.type === "restaurant" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h7a1 1 0 100-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM15 8a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L15 13.586V8z" />
                </svg>
              )}
              {activity.type === "attraction" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                </svg>
              )}
              {activity.type === "activity" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
              {activity.type === "transport" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                  <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                </svg>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile time/type indicator */}
            <div className="flex sm:hidden items-center gap-2 mb-2 text-sm">
              <div
                className={`w-6 h-6 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center flex-shrink-0`}
              >
                {activity.type === "restaurant" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h7a1 1 0 100-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM15 8a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L15 13.586V8z" />
                  </svg>
                )}
                {activity.type === "attraction" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                  </svg>
                )}
                {activity.type === "activity" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                )}
                {activity.type === "transport" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                    <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                  </svg>
                )}
              </div>
              <span className="font-medium text-slate-900">{activity.start_time}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">{activity.duration_minutes} min</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-slate-900 text-base sm:text-lg">
                    {activity.name}
                  </h4>
                  <span
                    className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} ${colors.border} border`}
                  >
                    {activity.type}
                  </span>
                  {activity.booking_required && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      Booking
                    </span>
                  )}
                </div>

                <p className="text-slate-600 mt-1 text-sm line-clamp-2">
                  {activity.description}
                </p>

                {/* Location */}
                <div className="flex items-start gap-2 mt-2 text-sm text-slate-500">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="line-clamp-1">{activity.address || activity.location}</span>
                </div>
              </div>

              {/* Price - shown inline on mobile */}
              <div className="sm:text-right flex-shrink-0 mt-1 sm:mt-0">
                {priceLoading ? (
                  <div className="h-6 w-16 bg-slate-100 rounded animate-pulse" />
                ) : verifiedPrice?.priceRange ? (
                  // Show verified Google price range when available (e.g., "EUR 40-50")
                  <>
                    <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                      {verifiedPrice.priceRange}
                    </div>
                    <div className="text-[10px] text-green-600 hidden sm:flex items-center gap-1 justify-end">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Google verified
                    </div>
                  </>
                ) : verifiedPrice?.priceLevel !== undefined ? (
                  // Convert price level to estimated range (don't show $$ symbols)
                  (() => {
                    const priceCurrency = activity.estimated_cost?.currency || currency;
                    const range = convertPriceLevelToRange(verifiedPrice.priceLevel, activity.type, priceCurrency);
                    const displayPrice = range
                      ? formatPriceRange(range.min, range.max, priceCurrency)
                      : `${priceCurrency} ${activity.estimated_cost?.amount || 0}`;
                    return (
                      <>
                        <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                          <span className="text-slate-400 font-normal text-xs sm:text-sm">~</span>
                          {displayPrice}
                        </div>
                        <div className="text-[10px] text-blue-600 hidden sm:flex items-center gap-1 justify-end" title={`Based on ${verifiedPrice.priceLevelLabel} venue tier`}>
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          Venue tier estimate
                        </div>
                      </>
                    );
                  })()
                ) : (
                  // Fallback to AI estimate
                  <>
                    <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                      <span className="text-slate-400 font-normal text-xs sm:text-sm">~</span>
                      {activity.estimated_cost.amount === 0
                        ? "Free"
                        : `${activity.estimated_cost.currency || currency} ${activity.estimated_cost.amount}`}
                    </div>
                    <div className="text-[10px] text-slate-400 hidden sm:block">AI estimate</div>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 mt-3">
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
                Maps
              </a>
              <a
                href={googleSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                Verify
              </a>
              {activity.official_website && (
                <a
                  href={activity.official_website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] text-xs font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Website
                </a>
              )}
              <button
                onClick={handleMoreClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors ml-auto min-h-[36px]"
              >
                {expanded && !isMobile ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    Less
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    More
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Content - Desktop only */}
      {expanded && !isMobile && (
        <div className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/50 overflow-hidden">
          {/* Photo Gallery */}
          {showGallery && (
            <div className="mb-4 overflow-hidden max-w-full">
              <PlaceGallery
                placeName={activity.name}
                placeAddress={activity.address || activity.location}
                maxPhotos={5}
                showRating={true}
              />
            </div>
          )}

          {/* Tips */}
          {activity.tips && activity.tips.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                Insider Tips
              </div>
              <ul className="space-y-1">
                {activity.tips.map((tip, i) => (
                  <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                    <span className="text-blue-400 mt-1">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Mobile Activity Detail Sheet */}
      <ActivityDetailSheet
        activity={activity}
        currency={currency}
        isOpen={showMobileSheet}
        onClose={() => setShowMobileSheet(false)}
      />
    </div>
  );
}
