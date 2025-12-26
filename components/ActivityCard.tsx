"use client";

import { useState, useEffect, useRef, memo } from "react";
import { useTranslations } from "next-intl";
import type { Activity } from "@/types";
import PlaceGallery from "./PlaceGallery";
import ActivityDetailSheet from "./ui/ActivityDetailSheet";
import { useCurrency, parsePriceRange } from "@/lib/locale";
import {
  convertPriceLevelToRange,
  getEstimatedPriceValue,
  type VerifiedPriceData,
} from "@/lib/utils/pricing";
import { getActivityTypeColors } from "@/lib/constants/activityColors";

interface ActivityCardProps {
  activity: Activity;
  index: number;
  currency?: string;
  showGallery?: boolean;
  /**
   * When true, photos will NOT be fetched automatically.
   * User can still trigger fetch via "Load Photos" button.
   * Used for saved trips to prevent automatic API costs.
   */
  disableAutoFetch?: boolean;
  /**
   * Callback fired when a Places API photo is captured.
   * Use this to persist the photo URL to the activity.
   */
  onPhotoCapture?: (activityId: string, photoUrl: string) => void;
}

function ActivityCard({
  activity,
  index,
  currency = "USD",
  showGallery = true,
  disableAutoFetch = false,
  onPhotoCapture,
}: ActivityCardProps) {
  const t = useTranslations('common');
  const [expanded, setExpanded] = useState(false);
  const [showMobileSheet, setShowMobileSheet] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [verifiedPrice, setVerifiedPrice] = useState<VerifiedPriceData | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  // Currency conversion hook - converts prices to user's preferred currency
  const { convert: convertCurrency, preferredCurrency } = useCurrency();

  // Helper to format price with currency conversion
  const formatPriceWithConversion = (amount: number, fromCurrency: string): string => {
    if (amount === 0) return t('activity.free');
    const converted = convertCurrency(amount, fromCurrency);
    return converted.formatted;
  };

  // Handle photo capture from PlaceGallery
  const handlePhotoCapture = (photoUrl: string) => {
    if (activity.id && onPhotoCapture) {
      onPhotoCapture(activity.id, photoUrl);
    }
  };

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

  // DISABLED: Price verification via Google Places API
  // This was causing $0.032 per activity card = massive costs
  // Each page view with 15 activities = $0.48
  // TODO: Re-enable with proper caching (localStorage + server cache) or lazy-load on "More" click
  //
  // useEffect(() => {
  //   // Only fetch for types that typically have price info
  //   if (!priceableTypes.includes(activity.type)) {
  //     return;
  //   }
  //
  //   // Skip if we already fetched for this exact activity
  //   if (fetchedActivityRef.current === activityKey) {
  //     return;
  //   }
  //
  //   const fetchVerifiedPrice = async () => {
  //     fetchedActivityRef.current = activityKey;
  //     setPriceLoading(true);
  //
  //     try {
  //       const response = await fetch("/api/places", {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({
  //           query: `${activity.name} ${activity.address || activity.location}`,
  //           maxPhotos: 1,
  //         }),
  //       });
  //
  //       if (response.ok) {
  //         const data = await response.json();
  //         if (data.priceRange || data.priceLevel !== undefined || data.priceLevelSymbol) {
  //           setVerifiedPrice({
  //             priceRange: data.priceRange,
  //             priceLevel: data.priceLevel,
  //             priceLevelSymbol: data.priceLevelSymbol,
  //             priceLevelLabel: data.priceLevelLabel,
  //           });
  //         }
  //       }
  //     } catch (error) {
  //       console.error("Failed to fetch verified price:", error);
  //     } finally {
  //       setPriceLoading(false);
  //     }
  //   };
  //
  //   fetchVerifiedPrice();
  // }, [activityKey, activity.name, activity.address, activity.location, activity.type]);

  // Always show AI estimate instead - no API call needed
  useEffect(() => {
    setPriceLoading(false);
  }, []);

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

  const colors = getActivityTypeColors(activity.type);

  return (
    <div
      className={`bg-white rounded-xl border transition-all duration-300 ${
        expanded ? "shadow-lg border-slate-300" : "shadow-sm border-slate-200 hover:shadow-md"
      }`}
    >
      {/* Activity Image Thumbnail - shown when image_url is available */}
      {activity.image_url && (
        <div className="relative h-32 sm:h-40 w-full overflow-hidden rounded-t-xl">
          <img
            src={activity.image_url}
            alt={activity.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* Gradient overlay for better text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          {/* Type badge overlay */}
          <div className="absolute bottom-2 left-2">
            <span
              className={`text-xs px-2 py-1 rounded-full backdrop-blur-sm bg-white/90 ${colors.text} border ${colors.border}`}
            >
              {activity.type}
            </span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="p-3 sm:p-4">
        <div className="flex gap-3 sm:gap-4">
          {/* Time Column - hidden on mobile, shows inline instead */}
          <div className="hidden sm:flex flex-shrink-0 text-center w-16 flex-col">
            <div className="text-lg font-semibold text-slate-900">
              {activity.start_time}
            </div>
            <div className="text-xs text-slate-500">
              {t('time.minutes', { count: activity.duration_minutes })}
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
              <span className="text-slate-500">{t('time.minutes', { count: activity.duration_minutes })}</span>
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
                      {t('activity.booking')}
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
                  // Parse range and convert to user's preferred currency (uses max value)
                  (() => {
                    const parsed = parsePriceRange(verifiedPrice.priceRange);
                    if (parsed) {
                      const displayPrice = formatPriceWithConversion(parsed.amount, parsed.currency);
                      return (
                        <>
                          <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                            {displayPrice}
                          </div>
                          <div className="text-[10px] text-green-600 hidden sm:flex items-center gap-1 justify-end">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            {t('activity.googleVerified')}
                          </div>
                        </>
                      );
                    }
                    // Fallback if parsing fails - display raw
                    return (
                      <>
                        <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                          {verifiedPrice.priceRange}
                        </div>
                        <div className="text-[10px] text-green-600 hidden sm:flex items-center gap-1 justify-end">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {t('activity.googleVerified')}
                        </div>
                      </>
                    );
                  })()
                ) : verifiedPrice?.priceLevel !== undefined ? (
                  // Convert price level to estimated range with currency conversion
                  (() => {
                    const priceCurrency = activity.estimated_cost?.currency || currency;
                    const range = convertPriceLevelToRange(verifiedPrice.priceLevel, activity.type, priceCurrency);
                    const priceValue = range
                      ? getEstimatedPriceValue(range.min, range.max)
                      : (activity.estimated_cost?.amount || 0);
                    const displayPrice = formatPriceWithConversion(priceValue, priceCurrency);
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
                          {t('activity.venueTierEstimate')}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  // Fallback to AI estimate with currency conversion
                  <>
                    <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                      <span className="text-slate-400 font-normal text-xs sm:text-sm">~</span>
                      {formatPriceWithConversion(
                        activity.estimated_cost.amount,
                        activity.estimated_cost.currency || currency
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 hidden sm:block">{t('activity.aiEstimate')}</div>
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
                {t('buttons.maps')}
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
                {t('buttons.verify')}
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
                  {t('buttons.website')}
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
                    {t('buttons.less')}
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    {t('buttons.more')}
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
                disableAutoFetch={disableAutoFetch}
                onFirstPhotoFetched={handlePhotoCapture}
                existingImageUrl={activity.image_url}
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
                {t('activity.insiderTips')}
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
        disableAutoFetch={disableAutoFetch}
        onPhotoCapture={handlePhotoCapture}
      />
    </div>
  );
}

// Memoize to prevent unnecessary re-renders when sibling activities update
export default memo(ActivityCard, (prevProps, nextProps) => {
  // Check activity identity and key visual properties
  if (prevProps.activity.id !== nextProps.activity.id) return false;
  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.currency !== nextProps.currency) return false;
  if (prevProps.showGallery !== nextProps.showGallery) return false;
  if (prevProps.disableAutoFetch !== nextProps.disableAutoFetch) return false;

  // Check key activity properties that affect rendering
  const prev = prevProps.activity;
  const next = nextProps.activity;
  if (prev.name !== next.name) return false;
  if (prev.start_time !== next.start_time) return false;
  if (prev.duration_minutes !== next.duration_minutes) return false;
  if (prev.image_url !== next.image_url) return false;
  if (prev.type !== next.type) return false;

  return true;
});
