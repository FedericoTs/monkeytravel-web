import { NextRequest, NextResponse } from "next/server";

/**
 * Activity Image API - Uses FREE Pexels API
 *
 * GET /api/images/activity?name=...&type=...&destination=...
 * Returns a relevant image URL for an activity
 */

const PEXELS_API_URL = "https://api.pexels.com/v1/search";

// In-memory cache (per-instance)
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 48 * 60 * 60 * 1000; // 48 hours

// Curated images by activity type - high-quality Pexels URLs
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
 * Generate cache key for activity
 */
function generateCacheKey(name: string, type: string, destination: string): string {
  return `${name}|${type}|${destination}`.toLowerCase().trim();
}

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
 * Fetch image from Pexels API
 */
async function fetchFromPexels(query: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;

  if (!apiKey) {
    console.warn("[Activity Images] PEXELS_API_KEY not configured");
    return null;
  }

  try {
    const response = await fetch(
      `${PEXELS_API_URL}?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      {
        headers: {
          Authorization: apiKey,
        },
      }
    );

    if (!response.ok) {
      console.error("[Activity Images] Pexels API error:", response.status);
      return null;
    }

    const data = await response.json();

    if (data.photos && data.photos.length > 0) {
      // Get random from top 3 for variety
      const randomIndex = Math.floor(Math.random() * Math.min(data.photos.length, 3));
      const photo = data.photos[randomIndex];
      return photo.src.medium || photo.src.large || photo.src.original;
    }

    return null;
  } catch (error) {
    console.error("[Activity Images] Pexels fetch error:", error);
    return null;
  }
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

  // Check in-memory cache
  const cacheKey = generateCacheKey(name, type, destination);
  const cached = imageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ url: cached.url, source: "cache" }, { headers: cacheHeaders });
  }

  // Try Pexels search with activity name + destination
  if (name && destination) {
    const pexelsUrl = await fetchFromPexels(`${name} ${destination}`);
    if (pexelsUrl) {
      imageCache.set(cacheKey, { url: pexelsUrl, timestamp: Date.now() });
      return NextResponse.json({ url: pexelsUrl, source: "pexels" }, { headers: cacheHeaders });
    }
  }

  // Try Pexels search with just activity name
  if (name) {
    const pexelsUrl = await fetchFromPexels(name);
    if (pexelsUrl) {
      imageCache.set(cacheKey, { url: pexelsUrl, timestamp: Date.now() });
      return NextResponse.json({ url: pexelsUrl, source: "pexels" }, { headers: cacheHeaders });
    }
  }

  // Fall back to curated image by type
  // Use a hash of the name to get consistent but varied images
  const hashIndex = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const curatedUrl = getCuratedImage(type, hashIndex);

  imageCache.set(cacheKey, { url: curatedUrl, timestamp: Date.now() });
  return NextResponse.json({ url: curatedUrl, source: "curated" }, { headers: cacheHeaders });
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
      return NextResponse.json({ error: "activities array is required" }, { status: 400 });
    }

    const images: Record<string, string> = {};

    // Process activities in parallel (max 5 concurrent for rate limiting)
    const batchSize = 5;
    for (let i = 0; i < activities.length; i += batchSize) {
      const batch = activities.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (activity: { name: string; type: string }) => {
          const cacheKey = generateCacheKey(activity.name, activity.type, destination || "");

          // Check cache first
          const cached = imageCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            images[activity.name] = cached.url;
            return;
          }

          // Try Pexels
          let url: string | null = null;
          if (destination) {
            url = await fetchFromPexels(`${activity.name} ${destination}`);
          }
          if (!url) {
            url = await fetchFromPexels(activity.name);
          }

          // Fall back to curated
          if (!url) {
            const hashIndex = activity.name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
            url = getCuratedImage(activity.type, hashIndex);
          }

          images[activity.name] = url;
          imageCache.set(cacheKey, { url, timestamp: Date.now() });
        })
      );
    }

    return NextResponse.json({ images, count: Object.keys(images).length });
  } catch (error) {
    console.error("[Activity Images] Batch error:", error);
    return NextResponse.json({ error: "Failed to fetch images" }, { status: 500 });
  }
}
