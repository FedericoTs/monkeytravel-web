/**
 * Server-side activity image fetching
 * Used by AI generate API to fetch images before returning to client
 * This prevents the race condition where users save before images load
 */

import { supabase } from "@/lib/supabase";
import crypto from "crypto";

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
    return null;
  }

  try {
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
      return null;
    }

    const data = await searchResponse.json();
    const place = data.places?.[0];
    const photo = place?.photos?.[0];

    if (!photo?.name) {
      return null;
    }

    const photoUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=400&maxWidthPx=600&key=${GOOGLE_PLACES_API_KEY}`;
    return photoUrl;
  } catch {
    return null;
  }
}

// Curated fallback images by activity type
const CURATED_BY_TYPE: Record<string, string[]> = {
  restaurant: [
    "https://images.pexels.com/photos/958545/pexels-photo-958545.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  food: [
    "https://images.pexels.com/photos/1099680/pexels-photo-1099680.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  foodie: [
    "https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cafe: [
    "https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  bar: [
    "https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  market: [
    "https://images.pexels.com/photos/2252584/pexels-photo-2252584.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  attraction: [
    "https://images.pexels.com/photos/1796715/pexels-photo-1796715.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  landmark: [
    "https://images.pexels.com/photos/2082103/pexels-photo-2082103.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  museum: [
    "https://images.pexels.com/photos/2034335/pexels-photo-2034335.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cultural: [
    "https://images.pexels.com/photos/2372978/pexels-photo-2372978.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nature: [
    "https://images.pexels.com/photos/147411/italy-mountains-dawn-daybreak-147411.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  park: [
    "https://images.pexels.com/photos/1179229/pexels-photo-1179229.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  activity: [
    "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  shopping: [
    "https://images.pexels.com/photos/135620/pexels-photo-135620.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  entertainment: [
    "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nightlife: [
    "https://images.pexels.com/photos/2114365/pexels-photo-2114365.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  spa: [
    "https://images.pexels.com/photos/3757942/pexels-photo-3757942.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  wellness: [
    "https://images.pexels.com/photos/3822864/pexels-photo-3822864.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  transport: [
    "https://images.pexels.com/photos/1031700/pexels-photo-1031700.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
};

const FALLBACK_IMAGES = [
  "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2087391/pexels-photo-2087391.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
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
 * Fetch image for a single activity
 */
async function fetchSingleActivityImage(
  name: string,
  type: string,
  destination: string
): Promise<string> {
  const cacheKey = generateCacheKey(name, destination);

  // 1. Check in-memory cache
  const memCached = imageCache.get(cacheKey);
  if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
    return memCached.url;
  }

  // 2. Check database cache
  const dbCached = await getFromDbCache(cacheKey);
  if (dbCached) {
    imageCache.set(cacheKey, { url: dbCached, timestamp: Date.now() });
    return dbCached;
  }

  // 3. Try Google Places API
  let url: string | null = null;
  if (destination) {
    url = await fetchFromGooglePlaces(`${name} ${destination}`);
  }
  if (!url) {
    url = await fetchFromGooglePlaces(name);
  }

  // 4. Fall back to curated if Google fails
  if (!url) {
    const hashIndex = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    url = getCuratedImage(type, hashIndex);
  } else {
    // Only cache Google results to DB
    await saveToDbCache(cacheKey, url);
  }

  imageCache.set(cacheKey, { url, timestamp: Date.now() });
  return url;
}

export interface ActivityWithImage {
  name: string;
  type: string;
  image_url?: string;
}

/**
 * Fetch images for all activities in an itinerary
 * Used by AI generate API to populate images before returning
 *
 * @param days - Array of itinerary days with activities
 * @param destination - Trip destination for context
 * @returns The same days array with image_url populated on each activity
 */
export async function fetchActivityImages<T extends { activities: ActivityWithImage[] }>(
  days: T[],
  destination: string
): Promise<T[]> {
  const startTime = Date.now();
  let fetchedCount = 0;

  // Process in batches of 5 for parallel fetching (rate limit friendly)
  const BATCH_SIZE = 5;

  for (const day of days) {
    for (let i = 0; i < day.activities.length; i += BATCH_SIZE) {
      const batch = day.activities.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (activity) => {
          // Skip if already has an image
          if (activity.image_url) return;

          try {
            activity.image_url = await fetchSingleActivityImage(
              activity.name,
              activity.type || "attraction",
              destination
            );
            fetchedCount++;
          } catch (error) {
            console.error(`[Activity Images] Error fetching image for ${activity.name}:`, error);
            // Use fallback on error
            const hashIndex = activity.name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
            activity.image_url = getCuratedImage(activity.type || "attraction", hashIndex);
          }
        })
      );
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Activity Images] Fetched ${fetchedCount} images in ${duration}ms`);

  return days;
}
