/**
 * Google Places Hotel Search API
 *
 * GET /api/hotels/places
 *
 * Searches for hotels near a location using Google Places Nearby Search.
 * Fast, reliable, and works well with activity-based geo-filtering.
 *
 * Note: Google Places doesn't provide pricing for lodging, but gives
 * ratings, photos, and location data for display purposes.
 *
 * CACHING: Uses Supabase google_places_cache to reduce API costs.
 * Cache duration: 30 days (hotel listings are stable; prices handled by booking links)
 */

import { NextRequest } from 'next/server';
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

// Cache duration: 30 days for hotel searches (listings are stable; real prices via booking links)
const CACHE_DURATION_DAYS = 30;

// Types for Google Places response
interface PlacePhoto {
  photo_reference: string;
  height: number;
  width: number;
}

interface PlaceGeometry {
  location: {
    lat: number;
    lng: number;
  };
}

interface PlaceResult {
  place_id: string;
  name: string;
  vicinity?: string;
  formatted_address?: string;
  geometry: PlaceGeometry;
  rating?: number;
  user_ratings_total?: number;
  photos?: PlacePhoto[];
  business_status?: string;
  opening_hours?: {
    open_now?: boolean;
  };
  types?: string[];
  price_level?: number; // Not available for lodging, but included for completeness
}

interface PlacesNearbyResponse {
  results: PlaceResult[];
  status: string;
  error_message?: string;
  next_page_token?: string;
}

// Haversine distance calculation
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get proximity label and color
function getProximityInfo(distanceKm: number): { label: string; color: string } {
  if (distanceKm < 0.5) {
    return { label: 'Walking distance', color: 'emerald' };
  }
  if (distanceKm < 1.5) {
    return { label: 'Very close', color: 'green' };
  }
  if (distanceKm < 3) {
    return { label: 'Nearby', color: 'blue' };
  }
  if (distanceKm < 6) {
    return { label: 'Short commute', color: 'amber' };
  }
  return { label: 'Further away', color: 'orange' };
}

// Format distance for display
function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
}

// Build Google Places photo URL
function getPhotoUrl(photoReference: string, maxWidth: number = 400): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${apiKey}`;
}

export interface HotelPlaceResult {
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

/**
 * Generate cache key hash for hotel search
 * Normalizes coordinates to 3 decimal places (within ~111m accuracy)
 */
function generateCacheKey(lat: number, lng: number, radius: number): string {
  // Round coordinates to 3 decimal places (~111m precision)
  const normalizedLat = lat.toFixed(3);
  const normalizedLng = lng.toFixed(3);
  const key = `hotels:${normalizedLat},${normalizedLng}:${radius}`;
  return crypto.createHash("md5").update(key).digest("hex");
}

/**
 * Check cache for existing hotel search data
 */
async function getFromCache(cacheKey: string): Promise<unknown | null> {
  try {
    const { data, error } = await supabase
      .from("google_places_cache")
      .select("*")
      .eq("place_id", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Update hit count asynchronously (fire and forget)
    supabase
      .from("google_places_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .then(() => {});

    return data.data;
  } catch {
    return null;
  }
}

/**
 * Store result in cache
 */
async function saveToCache(cacheKey: string, data: unknown): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await supabase.from("google_places_cache").upsert(
      {
        place_id: cacheKey,
        cache_type: "hotels_nearby",
        data,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );
  } catch (error) {
    console.error("[Hotels Cache] Save error:", error);
  }
}

/**
 * Log API request for cost tracking using centralized gateway
 */
async function logHotelApiRequest(options: {
  cacheHit?: boolean;
  status?: number;
  error?: string;
  responseTimeMs?: number;
}): Promise<void> {
  const { cacheHit = false, status = 200, error, responseTimeMs = 0 } = options;

  await logApiCall({
    apiName: "google_places_nearby",
    endpoint: "/place/nearbysearch/json (hotels)",
    status,
    responseTimeMs,
    cacheHit,
    costUsd: cacheHit || status >= 400 ? 0 : 0.032,
    error,
  });
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check API access control first
    const access = await checkApiAccess("google_places_nearby");
    if (!access.allowed) {
      await logHotelApiRequest({
        status: 503,
        error: `BLOCKED: ${access.message}`,
      });
      return errors.serviceUnavailable(access.message || "Hotel search API is currently disabled");
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey || !access.shouldPassKey) {
      await logHotelApiRequest({
        status: 500,
        error: "API key not configured or blocked",
      });
      return errors.internal('Google Places API key not configured', 'Hotels API');
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const latitude = parseFloat(searchParams.get('latitude') || '');
    const longitude = parseFloat(searchParams.get('longitude') || '');
    const radius = parseInt(searchParams.get('radius') || '5000'); // Default 5km in meters
    const destination = searchParams.get('destination') || '';
    const startDate = searchParams.get('startDate') || ''; // YYYY-MM-DD format
    const endDate = searchParams.get('endDate') || ''; // YYYY-MM-DD format

    // Validate required parameters
    if (isNaN(latitude) || isNaN(longitude)) {
      return errors.badRequest('Missing or invalid coordinates', { required: ['latitude', 'longitude'] });
    }

    // Check cache first
    const cacheKey = generateCacheKey(latitude, longitude, radius);
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      console.log("[Hotels API] Cache HIT for:", latitude.toFixed(3), longitude.toFixed(3));
      await logHotelApiRequest({ cacheHit: true });

      // Cached data contains the full response, but we need to update booking links with dates
      const cachedData = cachedResult as { hotels: HotelPlaceResult[]; meta: unknown };

      // Update booking links with current dates if provided
      if ((startDate && endDate) && cachedData.hotels) {
        cachedData.hotels = cachedData.hotels.map((hotel: HotelPlaceResult) => {
          const encodedName = encodeURIComponent(hotel.name);
          const encodedDestination = encodeURIComponent(destination || hotel.address || '');
          const bookingDateParams = `&checkin=${startDate}&checkout=${endDate}`;
          const expediaDateParams = `&startDate=${startDate}&endDate=${endDate}`;
          const hotelsDateParams = `&startDate=${startDate}&endDate=${endDate}`;
          const googleDateParams = `&q_check_in=${startDate}&q_check_out=${endDate}`;

          return {
            ...hotel,
            bookingLinks: {
              google: `https://www.google.com/travel/hotels/${encodedDestination}?q=${encodedName}${googleDateParams}`,
              booking: `https://www.booking.com/searchresults.html?ss=${encodedName}+${encodedDestination}${bookingDateParams}`,
              hotels: `https://www.hotels.com/search.do?q=${encodedName}+${encodedDestination}${hotelsDateParams}`,
              expedia: `https://www.expedia.com/Hotel-Search?destination=${encodedName}+${encodedDestination}${expediaDateParams}`,
            },
          };
        });
      }

      return apiSuccess({
        ...cachedData,
        meta: {
          ...(cachedData.meta as object),
          responseTime: Date.now() - startTime,
          cached: true,
        },
      });
    }

    console.log("[Hotels API] Cache MISS for:", latitude.toFixed(3), longitude.toFixed(3));

    // Build Google Places Nearby Search URL
    const placesUrl = new URL(
      'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
    );
    placesUrl.searchParams.set('location', `${latitude},${longitude}`);
    placesUrl.searchParams.set('radius', Math.min(radius, 50000).toString()); // Max 50km
    placesUrl.searchParams.set('type', 'lodging');
    placesUrl.searchParams.set('rankby', 'prominence'); // Get best-rated first
    placesUrl.searchParams.set('key', apiKey);

    // Fetch from Google Places
    const response = await fetch(placesUrl.toString());
    const data: PlacesNearbyResponse = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('[Google Places] API error:', data.status, data.error_message);
      return errors.internal(`Google Places API error: ${data.error_message || data.status}`, 'Hotels API');
    }

    // Transform and enrich results
    const hotels: HotelPlaceResult[] = (data.results || [])
      .filter((place) => place.business_status !== 'CLOSED_PERMANENTLY')
      .slice(0, 5) // Limit to 5 hotels for cleaner display
      .map((place) => {
        const distance = calculateDistance(
          latitude,
          longitude,
          place.geometry.location.lat,
          place.geometry.location.lng
        );
        const proximity = getProximityInfo(distance);

        // Build photo URLs
        const photos = (place.photos || []).slice(0, 5).map((photo) =>
          getPhotoUrl(photo.photo_reference, 800)
        );

        // Encode hotel name for booking links
        const encodedName = encodeURIComponent(place.name);
        const encodedDestination = encodeURIComponent(destination || place.vicinity || '');

        // Build date parameters for booking links
        // Booking.com: checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
        // Expedia: startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
        // Hotels.com: startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
        // Google Hotels: q_check_in=YYYY-MM-DD&q_check_out=YYYY-MM-DD
        const hasValidDates = startDate && endDate;
        const bookingDateParams = hasValidDates ? `&checkin=${startDate}&checkout=${endDate}` : '';
        const expediaDateParams = hasValidDates ? `&startDate=${startDate}&endDate=${endDate}` : '';
        const hotelsDateParams = hasValidDates ? `&startDate=${startDate}&endDate=${endDate}` : '';
        const googleDateParams = hasValidDates ? `&q_check_in=${startDate}&q_check_out=${endDate}` : '';

        return {
          id: place.place_id,
          name: place.name,
          address: place.vicinity || place.formatted_address || '',
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          rating: place.rating || 0,
          reviewCount: place.user_ratings_total || 0,
          photoUrl: photos[0] || null,
          photos,
          distance: Math.round(distance * 100) / 100,
          distanceFormatted: formatDistance(distance),
          proximityLabel: proximity.label,
          proximityColor: proximity.color,
          isOpen: place.opening_hours?.open_now ?? null,
          placeId: place.place_id,
          bookingLinks: {
            google: `https://www.google.com/travel/hotels/${encodedDestination}?q=${encodedName}${googleDateParams}`,
            booking: `https://www.booking.com/searchresults.html?ss=${encodedName}+${encodedDestination}${bookingDateParams}`,
            hotels: `https://www.hotels.com/search.do?q=${encodedName}+${encodedDestination}${hotelsDateParams}`,
            expedia: `https://www.expedia.com/Hotel-Search?destination=${encodedName}+${encodedDestination}${expediaDateParams}`,
          },
        };
      })
      .sort((a, b) => {
        // Sort by rating first (higher is better), then by distance (closer is better)
        if (b.rating !== a.rating) {
          return b.rating - a.rating;
        }
        return a.distance - b.distance;
      });

    const result = {
      hotels,
      meta: {
        count: hotels.length,
        center: { latitude, longitude },
        radius,
        responseTime: Date.now() - startTime,
      },
    };

    // Save to cache and log API usage
    saveToCache(cacheKey, result);
    await logHotelApiRequest({ responseTimeMs: Date.now() - startTime });

    return apiSuccess(result);
  } catch (error) {
    console.error('[Google Places Hotels] Error:', error);

    // Log the failure
    await logHotelApiRequest({
      status: 500,
      error: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startTime,
    });

    return errors.internal(
      `Failed to search hotels: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'Hotels API'
    );
  }
}
