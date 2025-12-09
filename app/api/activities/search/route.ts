/**
 * Activity Search API
 *
 * POST /api/activities/search
 *
 * Local-first activity search that mines activities from existing trips.
 * Falls back to Google Places Text Search only when local results are insufficient.
 *
 * Cost: $0 (local) or $0.032 (Google Places Text Search)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Activity } from "@/types";

// Activity type categories for filtering
const ACTIVITY_TYPE_CATEGORIES: Record<string, string[]> = {
  restaurant: ["restaurant", "food", "cafe", "bar", "foodie", "market"],
  attraction: ["attraction", "landmark", "museum", "cultural"],
  activity: ["activity", "entertainment", "nightlife", "event"],
  nature: ["nature", "park", "spa", "wellness"],
  shopping: ["shopping", "market"],
};

export interface ActivitySearchResult {
  id: string;
  name: string;
  type: string;
  description: string;
  address?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  duration_minutes: number;
  estimated_cost?: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
  image_url?: string;
  source: "local" | "google";
  googlePlaceId?: string;
}

interface SearchRequest {
  destination: string;
  query?: string;
  types?: string[];
  limit?: number;
  includeGoogle?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: SearchRequest = await request.json();
    const { destination, query = "", types = [], limit = 10, includeGoogle = true } = body;

    if (!destination) {
      return NextResponse.json(
        { error: "Destination is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Step 1: Search activities from existing trips
    const localResults = await searchLocalActivities(
      supabase,
      destination,
      query,
      types,
      limit
    );

    // If we have enough local results, return them
    if (localResults.length >= 3 || !includeGoogle) {
      return NextResponse.json({
        results: localResults.slice(0, limit),
        source: "local",
        hasMore: localResults.length >= limit,
      });
    }

    // Step 2: Fall back to Google Places Text Search if local results are insufficient
    // Only call Google if we have very few local results and query is specific
    if (query.length >= 3 && localResults.length < 3) {
      const googleResults = await searchGooglePlaces(destination, query, limit - localResults.length);

      // Combine results, local first (deduped by name)
      const seenNames = new Set(localResults.map(r => r.name.toLowerCase()));
      const combinedResults = [
        ...localResults,
        ...googleResults.filter(r => !seenNames.has(r.name.toLowerCase()))
      ];

      return NextResponse.json({
        results: combinedResults.slice(0, limit),
        source: "hybrid",
        hasMore: false,
      });
    }

    return NextResponse.json({
      results: localResults.slice(0, limit),
      source: "local",
      hasMore: localResults.length >= limit,
    });
  } catch (error) {
    console.error("Activity search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Search activities from existing trips in the database
 */
async function searchLocalActivities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  destination: string,
  query: string,
  types: string[],
  limit: number
): Promise<ActivitySearchResult[]> {
  // Query trips that match the destination
  // The destination is stored in itinerary days or can be extracted from trip title
  const { data: trips, error } = await supabase
    .from("trips")
    .select("id, title, itinerary")
    .not("itinerary", "is", null)
    .limit(100); // Get recent trips to mine activities from

  if (error || !trips) {
    console.error("Error fetching trips for activity search:", error);
    return [];
  }

  // Extract all activities from trips and filter by destination
  const activityMap = new Map<string, ActivitySearchResult>();
  const destinationLower = destination.toLowerCase();
  const queryLower = query.toLowerCase();

  // Expand type filters to include related types
  const expandedTypes = new Set<string>();
  types.forEach((type) => {
    expandedTypes.add(type);
    // Add related types from categories
    Object.entries(ACTIVITY_TYPE_CATEGORIES).forEach(([category, relatedTypes]) => {
      if (relatedTypes.includes(type) || category === type) {
        relatedTypes.forEach((t) => expandedTypes.add(t));
      }
    });
  });

  for (const trip of trips) {
    const itinerary = trip.itinerary as { activities: Activity[] }[] | null;
    if (!itinerary || !Array.isArray(itinerary)) continue;

    // Check if trip title or any activity location matches destination
    const tripMatchesDestination =
      trip.title?.toLowerCase().includes(destinationLower);

    for (const day of itinerary) {
      if (!day.activities || !Array.isArray(day.activities)) continue;

      for (const activity of day.activities) {
        // Check if activity location matches destination
        const locationMatches =
          tripMatchesDestination ||
          activity.location?.toLowerCase().includes(destinationLower) ||
          activity.address?.toLowerCase().includes(destinationLower);

        if (!locationMatches) continue;

        // Apply type filter if specified
        if (expandedTypes.size > 0 && !expandedTypes.has(activity.type)) {
          continue;
        }

        // Apply query filter if specified
        if (queryLower) {
          const nameMatches = activity.name?.toLowerCase().includes(queryLower);
          const descMatches = activity.description?.toLowerCase().includes(queryLower);
          const typeMatches = activity.type?.toLowerCase().includes(queryLower);
          if (!nameMatches && !descMatches && !typeMatches) continue;
        }

        // Use activity name as key for deduplication
        const key = activity.name?.toLowerCase().trim();
        if (!key || activityMap.has(key)) continue;

        activityMap.set(key, {
          id: `local_${activity.id || crypto.randomUUID()}`,
          name: activity.name,
          type: activity.type,
          description: activity.description || "",
          address: activity.address,
          coordinates: activity.coordinates,
          duration_minutes: activity.duration_minutes || 90,
          estimated_cost: activity.estimated_cost,
          image_url: activity.image_url,
          source: "local",
        });
      }
    }
  }

  // Sort by relevance (exact name match first, then contains query)
  const results = Array.from(activityMap.values());
  if (queryLower) {
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === queryLower;
      const bExact = b.name.toLowerCase() === queryLower;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;

      const aStarts = a.name.toLowerCase().startsWith(queryLower);
      const bStarts = b.name.toLowerCase().startsWith(queryLower);
      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;

      return 0;
    });
  }

  return results.slice(0, limit);
}

/**
 * Fall back to Google Places Text Search for specific queries
 * Cost: $0.032 per request
 */
async function searchGooglePlaces(
  destination: string,
  query: string,
  limit: number
): Promise<ActivitySearchResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("Google Places API key not configured");
    return [];
  }

  try {
    // Build search query combining destination and user query
    const searchQuery = `${query} in ${destination}`;

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?` +
        new URLSearchParams({
          query: searchQuery,
          key: apiKey,
        })
    );

    if (!response.ok) {
      console.error("Google Places search failed:", response.status);
      return [];
    }

    const data = await response.json();

    if (data.status !== "OK" || !data.results) {
      return [];
    }

    // Transform Google Places results to our format
    const results: ActivitySearchResult[] = data.results
      .slice(0, limit)
      .map((place: {
        place_id: string;
        name: string;
        types?: string[];
        formatted_address?: string;
        geometry?: { location: { lat: number; lng: number } };
        photos?: { photo_reference: string }[];
      }) => ({
        id: `google_${place.place_id}`,
        name: place.name,
        type: mapGoogleTypeToActivityType(place.types || []),
        description: "", // Google doesn't provide description in Text Search
        address: place.formatted_address,
        coordinates: place.geometry?.location
          ? {
              lat: place.geometry.location.lat,
              lng: place.geometry.location.lng,
            }
          : undefined,
        duration_minutes: 90, // Default duration
        source: "google" as const,
        googlePlaceId: place.place_id,
        image_url: place.photos?.[0]
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
          : undefined,
      }));

    return results;
  } catch (error) {
    console.error("Google Places search error:", error);
    return [];
  }
}

/**
 * Map Google Places types to our activity types
 */
function mapGoogleTypeToActivityType(googleTypes: string[]): string {
  const typeMapping: Record<string, string> = {
    restaurant: "restaurant",
    food: "food",
    cafe: "cafe",
    bar: "bar",
    bakery: "cafe",
    meal_takeaway: "restaurant",
    museum: "museum",
    art_gallery: "museum",
    church: "landmark",
    hindu_temple: "landmark",
    mosque: "landmark",
    synagogue: "landmark",
    tourist_attraction: "attraction",
    point_of_interest: "attraction",
    park: "park",
    natural_feature: "nature",
    zoo: "attraction",
    aquarium: "attraction",
    amusement_park: "entertainment",
    shopping_mall: "shopping",
    store: "shopping",
    spa: "spa",
    gym: "wellness",
    night_club: "nightlife",
    casino: "entertainment",
    stadium: "entertainment",
  };

  for (const googleType of googleTypes) {
    if (typeMapping[googleType]) {
      return typeMapping[googleType];
    }
  }

  return "attraction"; // Default type
}
