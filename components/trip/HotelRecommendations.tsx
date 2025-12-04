"use client";

/**
 * HotelRecommendations Component
 *
 * Premium hotel discovery section that displays curated hotels
 * near trip activities using Google Places API.
 *
 * Features:
 * - Activity-centroid based hotel search
 * - Elegant horizontal scrolling carousel
 * - Premium photo presentation
 * - Proximity indicators
 * - Affiliate booking links
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ItineraryDay } from "@/types";
import { getHotelSearchCenter, type GeoCenter } from "@/lib/utils/geo";

interface HotelResult {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviewCount: number;
  photoUrl: string | null;
  photos: string[];
  distance: number;
  distanceFormatted: string;
  proximityLabel: string;
  proximityColor: string;
  isOpen: boolean | null;
  placeId: string;
  bookingLinks: {
    google: string;
    booking: string;
    hotels: string;
    expedia: string;
  };
}

interface HotelRecommendationsProps {
  destination: string;
  itinerary: ItineraryDay[];
  startDate: string;
  endDate: string;
}

// Star rating component with half-star support
function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: fullStars }).map((_, i) => (
        <svg
          key={`full-${i}`}
          className="w-4 h-4 text-amber-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
      {hasHalfStar && (
        <svg className="w-4 h-4" viewBox="0 0 20 20">
          <defs>
            <linearGradient id="half-star">
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="50%" stopColor="#E5E7EB" />
            </linearGradient>
          </defs>
          <path
            fill="url(#half-star)"
            d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
          />
        </svg>
      )}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <svg
          key={`empty-${i}`}
          className="w-4 h-4 text-slate-200"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

// Proximity badge with color-coded background
function ProximityBadge({
  label,
  distance,
  color,
}: {
  label: string;
  distance: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    green: "bg-green-50 text-green-700 border-green-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        colorClasses[color] || colorClasses.blue
      }`}
    >
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      <span>{label}</span>
      <span className="opacity-60">({distance})</span>
    </div>
  );
}

// Single hotel card component
function HotelCard({
  hotel,
  index,
}: {
  hotel: HotelResult;
  index: number;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showBookingMenu, setShowBookingMenu] = useState(false);

  return (
    <div
      className="group relative flex-shrink-0 w-[320px] sm:w-[360px] bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-500 overflow-hidden border border-slate-100"
      style={{
        animationDelay: `${index * 100}ms`,
      }}
    >
      {/* Image Container */}
      <div className="relative h-52 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
        {hotel.photoUrl ? (
          <>
            <img
              src={hotel.photoUrl}
              alt={hotel.name}
              className={`w-full h-full object-cover transition-all duration-700 group-hover:scale-110 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setImageLoaded(true)}
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              className="w-16 h-16 text-slate-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
        )}

        {/* Rating badge on image */}
        {hotel.rating > 0 && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-sm">
            <span className="text-sm font-bold text-slate-900">
              {hotel.rating.toFixed(1)}
            </span>
            <svg
              className="w-4 h-4 text-amber-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </div>
        )}

        {/* Open now badge */}
        {hotel.isOpen === true && (
          <div className="absolute top-3 right-3 px-2 py-1 bg-emerald-500 text-white text-xs font-medium rounded-full">
            Open Now
          </div>
        )}

        {/* Hotel name on image */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h4 className="font-semibold text-white text-lg leading-tight line-clamp-2 drop-shadow-lg">
            {hotel.name}
          </h4>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Address */}
        <p className="text-sm text-slate-500 line-clamp-1">{hotel.address}</p>

        {/* Rating and reviews */}
        <div className="flex items-center gap-2">
          <StarRating rating={hotel.rating} />
          <span className="text-xs text-slate-400">
            ({hotel.reviewCount.toLocaleString()} reviews)
          </span>
        </div>

        {/* Proximity badge */}
        <ProximityBadge
          label={hotel.proximityLabel}
          distance={hotel.distanceFormatted}
          color={hotel.proximityColor}
        />

        {/* Booking section */}
        <div className="pt-2 border-t border-slate-100">
          <div className="relative">
            <button
              onClick={() => setShowBookingMenu(!showBookingMenu)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/90 text-white text-sm font-medium rounded-xl hover:shadow-lg hover:shadow-[var(--primary)]/20 transition-all active:scale-[0.98]"
            >
              <svg
                className="w-4 h-4"
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
              Check Availability
              <svg
                className={`w-4 h-4 transition-transform ${
                  showBookingMenu ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Booking dropdown */}
            {showBookingMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-10 animate-fade-in-up">
                <div className="p-2 space-y-1">
                  <a
                    href={hotel.bookingLinks.google}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">Google Hotels</div>
                      <div className="text-xs text-slate-500">Compare prices</div>
                    </div>
                  </a>
                  <a
                    href={hotel.bookingLinks.booking}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                      B
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">Booking.com</div>
                      <div className="text-xs text-slate-500">Book directly</div>
                    </div>
                  </a>
                  <a
                    href={hotel.bookingLinks.hotels}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center text-white text-xs font-bold">
                      H
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">Hotels.com</div>
                      <div className="text-xs text-slate-500">Collect rewards</div>
                    </div>
                  </a>
                  <a
                    href={hotel.bookingLinks.expedia}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-yellow-500 flex items-center justify-center text-white text-xs font-bold">
                      E
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">Expedia</div>
                      <div className="text-xs text-slate-500">Bundle & save</div>
                    </div>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HotelRecommendations({
  destination,
  itinerary,
  startDate,
  endDate,
}: HotelRecommendationsProps) {
  const [hotels, setHotels] = useState<HotelResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [searchMode, setSearchMode] = useState<"geo" | "destination">("geo");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Calculate activity center from itinerary
  const geoCenter = useMemo<GeoCenter | null>(() => {
    if (!itinerary || itinerary.length === 0) return null;
    return getHotelSearchCenter(itinerary);
  }, [itinerary]);

  // Calculate nights
  const nights = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }, [startDate, endDate]);

  // Extract the best address from itinerary for geocoding
  // This solves the ambiguity problem (e.g., "Georgetown" could be DC or TX,
  // but "710 S Main St, Georgetown, TX 78626" is unambiguous)
  const bestGeocodingAddress = useMemo(() => {
    // First, try to get an address from the first activity
    for (const day of itinerary) {
      for (const activity of day.activities) {
        // Prefer full addresses with state/country info
        if (activity.address && activity.address.length > 20) {
          return activity.address;
        }
        // Fall back to location if available
        if (activity.location && activity.location.length > 10) {
          return activity.location;
        }
      }
    }
    // Last resort: use the destination (trip title)
    return destination;
  }, [itinerary, destination]);

  // Fetch hotels via geocoding (fallback when no activity coordinates)
  const fetchHotelsViaGeocoding = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSearchMode("destination");

    try {
      // Use the best available address for geocoding (solves ambiguity)
      // e.g., "Georgetown, TX 78626" instead of just "Georgetown"
      const geocodeQuery = bestGeocodingAddress;
      console.log("[HotelRecommendations] Geocoding with:", geocodeQuery);

      const geocodeResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(geocodeQuery)}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
      );
      const geocodeData = await geocodeResponse.json();

      if (geocodeData.status !== "OK" || !geocodeData.results?.[0]) {
        throw new Error("Could not find destination coordinates");
      }

      const location = geocodeData.results[0].geometry.location;
      console.log("[HotelRecommendations] Geocoded to:", location, geocodeData.results[0].formatted_address);

      // Now search for hotels near that location
      const params = new URLSearchParams({
        latitude: location.lat.toString(),
        longitude: location.lng.toString(),
        radius: "10000", // 10km default radius for destination search
        destination,
      });

      const response = await fetch(`/api/hotels/places?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch hotels");
      }

      setHotels(data.hotels || []);
      setHasLoaded(true);
    } catch (err) {
      console.error("Error fetching hotels via geocoding:", err);
      setError(err instanceof Error ? err.message : "Failed to load hotels");
    } finally {
      setLoading(false);
    }
  }, [bestGeocodingAddress, destination]);

  // Fetch hotels using activity centroid
  const fetchHotelsViaGeoCenter = useCallback(async () => {
    if (!geoCenter) return;

    setLoading(true);
    setError(null);
    setSearchMode("geo");

    try {
      const params = new URLSearchParams({
        latitude: geoCenter.center.lat.toString(),
        longitude: geoCenter.center.lng.toString(),
        radius: Math.ceil(geoCenter.radius * 1000).toString(), // Convert km to meters
        destination,
      });

      const response = await fetch(`/api/hotels/places?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch hotels");
      }

      setHotels(data.hotels || []);
      setHasLoaded(true);
    } catch (err) {
      console.error("Error fetching hotels:", err);
      setError(err instanceof Error ? err.message : "Failed to load hotels");
    } finally {
      setLoading(false);
    }
  }, [geoCenter, destination]);

  // Fetch hotels - prefer geo center, fallback to destination geocoding
  const fetchHotels = useCallback(async () => {
    if (geoCenter && geoCenter.coverage >= 30) {
      await fetchHotelsViaGeoCenter();
    } else {
      // Fallback: geocode destination and search nearby
      await fetchHotelsViaGeocoding();
    }
  }, [geoCenter, fetchHotelsViaGeoCenter, fetchHotelsViaGeocoding]);

  // Auto-fetch on mount
  useEffect(() => {
    if (!hasLoaded && !loading && destination) {
      fetchHotels();
    }
  }, [hasLoaded, loading, destination, fetchHotels]);

  // Scroll handlers
  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -380, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 380, behavior: "smooth" });
    }
  };

  // Always render if we have a destination
  if (!destination) {
    return null;
  }

  return (
    <section className="mb-10">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--accent)] to-amber-400 flex items-center justify-center shadow-lg shadow-amber-200/50">
              <svg
                className="w-5 h-5 text-slate-900"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                Curated Stays
              </h3>
              <p className="text-sm text-slate-500">
                {geoCenter
                  ? `Hotels near your ${geoCenter.activityCount} planned activities`
                  : `Hotels in ${destination}`}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation arrows - Hidden on mobile */}
        {hotels.length > 3 && (
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={scrollLeft}
              className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              aria-label="Scroll left"
            >
              <svg
                className="w-5 h-5 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              onClick={scrollRight}
              className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              aria-label="Scroll right"
            >
              <svg
                className="w-5 h-5 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Date context badge */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full text-sm text-slate-600">
          <svg
            className="w-4 h-4"
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
          <span>
            {startDate} - {endDate}
          </span>
          <span className="text-slate-400">
            ({nights} {nights === 1 ? "night" : "nights"})
          </span>
        </div>
        {geoCenter && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-sm">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span>Within {Math.ceil(geoCenter.radius)}km of activities</span>
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[320px] sm:w-[360px] bg-white rounded-2xl border border-slate-100 overflow-hidden"
            >
              <div className="h-52 bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
                <div className="h-8 bg-slate-100 rounded-full animate-pulse w-1/3" />
                <div className="h-10 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">
              Couldn&apos;t load hotel recommendations
            </p>
            <p className="text-xs text-red-600">{error}</p>
          </div>
          <button
            onClick={fetchHotels}
            className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Hotels carousel */}
      {!loading && !error && hotels.length > 0 && (
        <div
          ref={scrollContainerRef}
          className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {hotels.map((hotel, index) => (
            <div key={hotel.id} className="snap-start">
              <HotelCard hotel={hotel} index={index} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && hasLoaded && hotels.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
          <h4 className="font-medium text-slate-900 mb-1">
            No hotels found nearby
          </h4>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            We couldn&apos;t find hotels near your planned activities. Try expanding your search on Google Maps or Booking.com.
          </p>
        </div>
      )}

      {/* Disclaimer */}
      {hotels.length > 0 && (
        <p className="mt-4 text-xs text-slate-400 text-center">
          Hotel data provided by Google Places. Prices and availability may vary.
          Book directly with the hotel for best rates.
        </p>
      )}
    </section>
  );
}
