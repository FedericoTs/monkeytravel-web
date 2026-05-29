/**
 * Activity Search API
 *
 * POST /api/activities/search
 *
 * Local-first activity search backed by the `activity_index` materialized
 * view (see supabase/migrations/20260530_activity_index_mview.sql). The MV
 * flattens trips.itinerary into one row per activity with normalised text
 * (lower + unaccent) and trigram GIN indexes for fuzzy match.
 *
 * Falls back to Google Places Text Search only when local results are
 * insufficient AND the user query is specific enough to be worth $0.032.
 *
 * Cost: $0 (local) or $0.032 (Google Places Text Search)
 *
 * Refresh: daily Vercel cron — /api/cron/refresh-activity-index.
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";

// 30 req/min/IP — covers a fast typist hammering AddActivityButton's debounced
// search, blocks bots. Mirrors task #200 (places-autocomplete) cap.
const limiter = createRateLimiter("activity-search", 30, 60_000);

// Activity type categories for filtering — kept in sync with AddActivityButton's
// ACTIVITY_CATEGORIES so the wizard pill UI lines up with what we send the RPC.
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

// Shape of a row returned by the search_activities() RPC. Mirrors the
// RETURNS TABLE definition in 20260530_activity_index_mview.sql.
interface ActivityIndexRow {
  row_key: string;
  trip_id: string;
  name: string;
  type: string;
  description: string | null;
  address: string | null;
  location: string | null;
  coordinates: { lat: number; lng: number } | null;
  duration_minutes: number | null;
  estimated_cost: ActivitySearchResult["estimated_cost"] | null;
  image_url: string | null;
  similarity: number;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit anon + authed callers alike — the Google fallback at $0.032/req
    // and the trgm RPC are both worth protecting from runaway clients.
    const { allowed } = limiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many activity searches. Please slow down.");
    }

    const body: SearchRequest = await request.json();
    const { destination, query = "", types = [], limit = 10, includeGoogle: requestedIncludeGoogle = true } = body;

    if (!destination) {
      return errors.badRequest("Destination is required");
    }

    const supabase = await createClient();

    // Only authed users can opt into the Google Places Text Search fallback
    // ($0.032/req — 11× autocomplete). Anonymous callers are capped to the
    // local activity_index MV (444 curated rows, $0/req). This caps cost
    // exposure to the authed-user count, not the public visitor count.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const includeGoogle = requestedIncludeGoogle && !!user;

    // Step 1: Search activities from existing trips via the MV-backed RPC.
    const localResults = await searchLocalActivities(
      supabase,
      destination,
      query,
      types,
      limit
    );

    // If we have enough local results, return them
    if (localResults.length >= 3 || !includeGoogle) {
      return apiSuccess({
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

      return apiSuccess({
        results: combinedResults.slice(0, limit),
        source: "hybrid",
        hasMore: false,
      });
    }

    return apiSuccess({
      results: localResults.slice(0, limit),
      source: "local",
      hasMore: localResults.length >= limit,
    });
  } catch (error) {
    console.error("[Activities Search] Activity search error:", error);
    return errors.internal("Internal server error", "Activities Search");
  }
}

/**
 * Search activities from existing trips via the activity_index MV.
 *
 * Pre-refactor (#191) this SELECTed trips.id+title+itinerary LIMIT 100 and
 * looped in Node using includes() — substring-only, no fuzzy/typo/accent
 * tolerance, several MB of JSONB over the wire per call. The MV pushes all
 * of that into Postgres with trigram indexes.
 */
async function searchLocalActivities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  destination: string,
  query: string,
  types: string[],
  limit: number
): Promise<ActivitySearchResult[]> {
  // Expand the wizard's category pills (restaurant / attraction / activity /
  // nature / shopping) into the flat type vocabulary stored in the MV. Empty
  // array → no type filter (matches search_activities's NULL/empty-array branch).
  const expandedTypes = new Set<string>();
  types.forEach((type) => {
    expandedTypes.add(type);
    Object.entries(ACTIVITY_TYPE_CATEGORIES).forEach(([category, relatedTypes]) => {
      if (relatedTypes.includes(type) || category === type) {
        relatedTypes.forEach((t) => expandedTypes.add(t));
      }
    });
  });

  const { data, error } = await supabase.rpc("search_activities", {
    q: query ?? "",
    dest: destination,
    types: expandedTypes.size > 0 ? Array.from(expandedTypes) : null,
    lim: limit,
  });

  if (error) {
    console.error("[Activity Search] search_activities RPC failed:", error);
    return [];
  }

  const rows = (data ?? []) as ActivityIndexRow[];

  // Dedupe by lowercased name — multiple trips often reference the same place
  // (e.g. "Sagrada Família" across every Barcelona itinerary). Highest similarity
  // wins because the RPC already returns rows ordered by similarity DESC.
  const seen = new Set<string>();
  const results: ActivitySearchResult[] = [];
  for (const row of rows) {
    const key = row.name?.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    results.push({
      // Stable id so AddActivityButton's React keys don't churn between
      // keystrokes for the same underlying activity row.
      id: `local_${row.row_key}`,
      name: row.name,
      type: row.type,
      description: row.description ?? "",
      address: row.address ?? undefined,
      coordinates: row.coordinates ?? undefined,
      duration_minutes: row.duration_minutes ?? 90,
      estimated_cost: row.estimated_cost ?? undefined,
      image_url: row.image_url ?? undefined,
      source: "local",
    });
  }

  return results;
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
    console.warn("[Activity Search] Google Places API key not configured");
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
      console.error("[Activity Search] Google Places search failed:", response.status);
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
    console.error("[Activity Search] Google Places search error:", error);
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
