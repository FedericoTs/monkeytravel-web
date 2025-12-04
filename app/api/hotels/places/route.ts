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
 */

import { NextRequest, NextResponse } from 'next/server';

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
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
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

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Google Maps API key not configured' },
        { status: 503 }
      );
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const latitude = parseFloat(searchParams.get('latitude') || '');
    const longitude = parseFloat(searchParams.get('longitude') || '');
    const radius = parseInt(searchParams.get('radius') || '5000'); // Default 5km in meters
    const destination = searchParams.get('destination') || '';

    // Validate required parameters
    if (isNaN(latitude) || isNaN(longitude)) {
      return NextResponse.json(
        {
          error: 'Missing or invalid coordinates',
          required: ['latitude', 'longitude'],
        },
        { status: 400 }
      );
    }

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
      return NextResponse.json(
        {
          error: 'Google Places API error',
          details: data.error_message || data.status,
        },
        { status: 500 }
      );
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
            google: `https://www.google.com/travel/hotels/${encodedDestination}?q=${encodedName}`,
            booking: `https://www.booking.com/searchresults.html?ss=${encodedName}+${encodedDestination}`,
            hotels: `https://www.hotels.com/search.do?q=${encodedName}+${encodedDestination}`,
            expedia: `https://www.expedia.com/Hotel-Search?destination=${encodedName}+${encodedDestination}`,
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

    return NextResponse.json({
      hotels,
      meta: {
        count: hotels.length,
        center: { latitude, longitude },
        radius,
        responseTime: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('[Google Places Hotels] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to search hotels',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
