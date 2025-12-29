import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

/**
 * Activity Image API - Uses Google Places API for REAL photos
 *
 * Priority:
 * 1. Check cache (30 days)
 * 2. Google Places API for real location photos
 * 3. Fall back to curated images if API fails
 *
 * GET /api/images/activity?name=...&type=...&destination=...
 * Returns a relevant image URL for an activity
 */

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Database cache duration: 30 days for place photos
const DB_CACHE_DURATION_DAYS = 30;

// In-memory cache (per-instance, for speed)
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in-memory

/**
 * Generate cache key hash for an activity
 */
function generateCacheKey(name: string, destination: string): string {
  const normalized = `${name}|${destination}`.toLowerCase().trim();
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Check database cache for existing image
 */
async function getFromDbCache(cacheKey: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("google_places_cache")
      .select("data")
      .eq("place_id", `activity_img_${cacheKey}`)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;
    return (data.data as { imageUrl?: string })?.imageUrl || null;
  } catch {
    return null;
  }
}

/**
 * Save image URL to database cache
 */
async function saveToDbCache(cacheKey: string, imageUrl: string): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + DB_CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await supabase.from("google_places_cache").upsert(
      {
        place_id: `activity_img_${cacheKey}`,
        cache_type: "activity_image",
        data: { imageUrl },
        request_hash: cacheKey,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );
  } catch (error) {
    console.error("[Activity Images] Cache save error:", error);
  }
}

/**
 * Fetch image from Google Places API
 */
async function fetchFromGooglePlaces(query: string): Promise<string | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn("[Activity Images] GOOGLE_PLACES_API_KEY not configured");
    return null;
  }

  try {
    // Use Text Search to find the place
    const searchResponse = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "places.photos",
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 1,
        }),
      }
    );

    if (!searchResponse.ok) {
      console.error("[Activity Images] Google Places API error:", searchResponse.status);
      return null;
    }

    const data = await searchResponse.json();
    const place = data.places?.[0];
    const photo = place?.photos?.[0];

    if (!photo?.name) {
      return null;
    }

    // Construct the photo URL
    const photoUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=400&maxWidthPx=600&key=${GOOGLE_PLACES_API_KEY}`;
    return photoUrl;
  } catch (error) {
    console.error("[Activity Images] Google Places fetch error:", error);
    return null;
  }
}

// Curated fallback images by activity type
const CURATED_BY_TYPE: Record<string, string[]> = {
  // Food & Drink
  restaurant: [
    "https://images.pexels.com/photos/958545/pexels-photo-958545.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  food: [
    "https://images.pexels.com/photos/1099680/pexels-photo-1099680.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  foodie: [
    "https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cafe: [
    "https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1995010/pexels-photo-1995010.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  bar: [
    "https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/696218/pexels-photo-696218.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  market: [
    "https://images.pexels.com/photos/2252584/pexels-photo-2252584.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3296398/pexels-photo-3296398.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],

  // Attractions & Culture
  attraction: [
    "https://images.pexels.com/photos/1796715/pexels-photo-1796715.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2363/france-landmark-lights-night.jpg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  landmark: [
    "https://images.pexels.com/photos/2082103/pexels-photo-2082103.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1461974/pexels-photo-1461974.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  museum: [
    "https://images.pexels.com/photos/2034335/pexels-photo-2034335.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3004909/pexels-photo-3004909.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cultural: [
    "https://images.pexels.com/photos/2372978/pexels-photo-2372978.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3290068/pexels-photo-3290068.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],

  // Nature & Outdoors
  nature: [
    "https://images.pexels.com/photos/147411/italy-mountains-dawn-daybreak-147411.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1287145/pexels-photo-1287145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  park: [
    "https://images.pexels.com/photos/1179229/pexels-photo-1179229.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1770809/pexels-photo-1770809.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  activity: [
    "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2387873/pexels-photo-2387873.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],

  // Shopping & Entertainment
  shopping: [
    "https://images.pexels.com/photos/135620/pexels-photo-135620.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1488463/pexels-photo-1488463.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  entertainment: [
    "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nightlife: [
    "https://images.pexels.com/photos/2114365/pexels-photo-2114365.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],

  // Wellness
  spa: [
    "https://images.pexels.com/photos/3757942/pexels-photo-3757942.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3865676/pexels-photo-3865676.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  wellness: [
    "https://images.pexels.com/photos/3822864/pexels-photo-3822864.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],

  // Transport
  transport: [
    "https://images.pexels.com/photos/1031700/pexels-photo-1031700.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
};

// Generic travel fallback
const FALLBACK_IMAGES = [
  "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2087391/pexels-photo-2087391.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2373201/pexels-photo-2373201.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
];

/**
 * Get curated image for activity type
 */
function getCuratedImage(type: string, index: number = 0): string {
  const images = CURATED_BY_TYPE[type.toLowerCase()];
  if (images && images.length > 0) {
    return images[index % images.length];
  }
  return FALLBACK_IMAGES[index % FALLBACK_IMAGES.length];
}

/**
 * GET /api/images/activity
 *
 * Query params:
 * - name: Activity name (e.g., "Eiffel Tower")
 * - type: Activity type (e.g., "landmark", "restaurant")
 * - destination: Trip destination (e.g., "Paris")
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get("name") || "";
  const type = searchParams.get("type") || "attraction";
  const destination = searchParams.get("destination") || "";

  // Cache headers for CDN
  const cacheHeaders = {
    "Cache-Control": "public, s-maxage=172800, stale-while-revalidate=86400", // 48h CDN, 24h stale
  };

  const cacheKey = generateCacheKey(name, destination);

  // 1. Check in-memory cache first (fastest)
  const memCached = imageCache.get(cacheKey);
  if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
    return apiSuccess({ url: memCached.url, source: "memory_cache" }, { headers: cacheHeaders });
  }

  // 2. Check database cache (persisted across deployments)
  const dbCached = await getFromDbCache(cacheKey);
  if (dbCached) {
    imageCache.set(cacheKey, { url: dbCached, timestamp: Date.now() });
    return apiSuccess({ url: dbCached, source: "db_cache" }, { headers: cacheHeaders });
  }

  // 3. Try Google Places API for real location photos
  if (name && destination) {
    const googleUrl = await fetchFromGooglePlaces(`${name} ${destination}`);
    if (googleUrl) {
      imageCache.set(cacheKey, { url: googleUrl, timestamp: Date.now() });
      await saveToDbCache(cacheKey, googleUrl);
      return apiSuccess({ url: googleUrl, source: "google_places" }, { headers: cacheHeaders });
    }
  }

  // 4. Try Google Places with just activity name
  if (name) {
    const googleUrl = await fetchFromGooglePlaces(name);
    if (googleUrl) {
      imageCache.set(cacheKey, { url: googleUrl, timestamp: Date.now() });
      await saveToDbCache(cacheKey, googleUrl);
      return apiSuccess({ url: googleUrl, source: "google_places" }, { headers: cacheHeaders });
    }
  }

  // 5. Fall back to curated image by type
  const hashIndex = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const curatedUrl = getCuratedImage(type, hashIndex);

  imageCache.set(cacheKey, { url: curatedUrl, timestamp: Date.now() });
  return apiSuccess({ url: curatedUrl, source: "curated" }, { headers: cacheHeaders });
}

/**
 * POST /api/images/activity
 *
 * Batch fetch images for multiple activities
 * Body: { activities: [{ name, type }], destination: string }
 * Returns: { images: { [name]: url } }
 */
export async function POST(request: NextRequest) {
  try {
    const { activities, destination } = await request.json();

    if (!activities || !Array.isArray(activities)) {
      return errors.badRequest("activities array is required");
    }

    const images: Record<string, string> = {};

    // Process activities in parallel (max 3 concurrent for Google API rate limiting)
    const batchSize = 3;
    for (let i = 0; i < activities.length; i += batchSize) {
      const batch = activities.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (activity: { name: string; type: string }) => {
          const cacheKey = generateCacheKey(activity.name, destination || "");

          // 1. Check in-memory cache
          const memCached = imageCache.get(cacheKey);
          if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
            images[activity.name] = memCached.url;
            return;
          }

          // 2. Check database cache
          const dbCached = await getFromDbCache(cacheKey);
          if (dbCached) {
            images[activity.name] = dbCached;
            imageCache.set(cacheKey, { url: dbCached, timestamp: Date.now() });
            return;
          }

          // 3. Try Google Places API
          let url: string | null = null;
          if (destination) {
            url = await fetchFromGooglePlaces(`${activity.name} ${destination}`);
          }
          if (!url) {
            url = await fetchFromGooglePlaces(activity.name);
          }

          // 4. Fall back to curated if Google fails
          if (!url) {
            const hashIndex = activity.name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
            url = getCuratedImage(activity.type, hashIndex);
          } else {
            // Only cache Google results to DB (not curated)
            await saveToDbCache(cacheKey, url);
          }

          images[activity.name] = url;
          imageCache.set(cacheKey, { url, timestamp: Date.now() });
        })
      );
    }

    return apiSuccess({ images, count: Object.keys(images).length });
  } catch (error) {
    console.error("[Activity Images] Batch error:", error);
    return errors.internal("Failed to fetch images", "Activity Images");
  }
}
