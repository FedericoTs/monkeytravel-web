/**
 * Server-side activity image fetching
 * Used by AI generate API to fetch images before returning to client
 * This prevents the race condition where users save before images load
 *
 * 2026-05-31 dedup pass (task #339):
 * - Migrated the ad-hoc memory + DB cache to `cache.withDatabase('place_search', ...)`.
 *   This is the SAME pool used by other place_search consumers, so a lookup any
 *   trip generation has ever done benefits every future trip generation.
 * - `fetchActivityImages` now collects ALL activity names across ALL days first,
 *   deduplicates by normalized key, then resolves each unique key exactly once
 *   in parallel — so e.g. a trip with "Colosseum" on day 2 and day 5 makes ONE
 *   Places call, not two. (`cache.withDatabase` also dedupes in-flight requests
 *   across concurrent route invocations via its inflight map.)
 * - TTL extended from 30 days to 365 days. Places metadata (photo refs, coords)
 *   for popular tourist sites is effectively immutable.
 */

import { cache } from "@/lib/cache";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// 365 days — Places metadata for popular tourist sites is effectively immutable.
// Photo reference names from the new Places API are stable, and our /api/places/photo
// proxy resolves them on demand, so a stale ref still works.
const ACTIVITY_IMAGE_CACHE_DAYS = 365;

/**
 * Normalize an activity name + destination into a stable cache key.
 * Lowercased, trimmed, punctuation stripped, internal whitespace collapsed.
 * Two activities that differ only in casing or punctuation share the same key.
 *
 * Examples:
 *   "Colosseum, Rome" + "Rome, Italy"   → "colosseum rome|rome italy"
 *   "colosseum  rome" + "rome, italy"   → "colosseum rome|rome italy"
 *   "The Colosseum!"  + "Rome"          → "the colosseum|rome"
 */
export function normalizeActivityKey(name: string, destination: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")  // strip combining accents
      .replace(/[^\p{L}\p{N}\s|]/gu, " ") // drop punctuation (keep letters/numbers/whitespace)
      .replace(/\s+/g, " ")
      .trim();

  return `${clean(name)}|${clean(destination)}`;
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

    // **2026-05-24 live-test fix (revision 2):** Both the raw
    // `places.googleapis.com/v1/.../media?key=...` URL AND the resolved
    // `lh3.googleusercontent.com/place-photos/...` URL return HTTP 504
    // to direct browser loads. (Verified via Chrome network panel —
    // every request from monkeytravel.app got 504.) Google's Places
    // photo endpoints are effectively server-side-only for us.
    //
    // We therefore return our own proxy URL pointing at
    // `/api/places/photo?name=...`, which fetches and streams the JPEG
    // server-side. The proxy hides the API key and lets Vercel's CDN
    // cache the result for a year.
    return `/api/places/photo?name=${encodeURIComponent(photo.name)}&w=600&h=400`;
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
 * Stable curated-image picker based on activity name. Returns the same image
 * for the same name+type combo so a fallback hit is deterministic.
 */
function curatedFor(name: string, type: string): string {
  const hashIndex = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return getCuratedImage(type || "attraction", hashIndex);
}

/**
 * Cached payload shape stored under the place_search pool.
 * We persist the resolved image URL (or `null` if Places couldn't help) so a
 * "Places returned nothing" miss is itself cached — we don't re-burn quota
 * looking up activities that have no Places match.
 */
interface CachedActivityImage {
  imageUrl: string | null;
}

/**
 * Resolve a single unique activity via the unified place_search cache.
 * Uses cache.withDatabase so we get: in-memory layer + cross-trip DB cache +
 * in-flight request dedup, all for free.
 */
async function resolveActivityImage(
  name: string,
  destination: string,
  normalizedKey: string
): Promise<string | null> {
  // Cache namespace + identifier. `cache.generateKey` will MD5 these together,
  // but the input is our pre-normalized key so two callers asking for
  // "Colosseum, Rome" / "Rome, Italy" hit the same row regardless of casing
  // or punctuation drift in the input.
  const { data } = await cache.withDatabase<CachedActivityImage>(
    "place_search",
    `activity_img:${normalizedKey}`,
    {
      cacheDays: ACTIVITY_IMAGE_CACHE_DAYS,
      cacheType: "activity_image",
      fetcher: async () => {
        let url: string | null = null;
        if (destination) {
          url = await fetchFromGooglePlaces(`${name} ${destination}`);
        }
        if (!url) {
          url = await fetchFromGooglePlaces(name);
        }
        return { imageUrl: url };
      },
    }
  );

  return data?.imageUrl ?? null;
}

export interface ActivityWithImage {
  name: string;
  type: string;
  image_url?: string;
}

/**
 * Fetch images for all activities in an itinerary.
 * Used by AI generate API to populate images before returning.
 *
 * Dedup strategy (2026-05-31):
 *   1. Flatten every activity across every day.
 *   2. Skip any that already have `image_url`.
 *   3. Group by normalized key — same key → same Places lookup.
 *   4. Resolve each UNIQUE key exactly once in parallel.
 *   5. Fan the resolved URL back out to every activity that shared that key.
 *
 * A trip with "Colosseum" on day 2 and day 5 makes one Places call, not two.
 * Across trips, the place_search DB cache ensures the second trip pays nothing.
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

  // ---------- Step 1+2: collect activities needing resolution. ----------
  // We track each occurrence by its (day, index) so we can write the URL
  // back to the exact reference later.
  type Pending = {
    activity: ActivityWithImage;
    normalizedKey: string;
    name: string;
    type: string;
  };

  const pending: Pending[] = [];
  for (const day of days) {
    for (const activity of day.activities) {
      if (activity.image_url) continue; // already has one — skip
      const name = activity.name || "";
      if (!name) continue;
      pending.push({
        activity,
        normalizedKey: normalizeActivityKey(name, destination || ""),
        name,
        type: activity.type || "attraction",
      });
    }
  }

  // ---------- Step 3: dedupe by normalized key. ----------
  // groups[key] = list of every activity reference that wants this key's URL.
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    const list = groups.get(p.normalizedKey);
    if (list) {
      list.push(p);
    } else {
      groups.set(p.normalizedKey, [p]);
    }
  }

  const totalActivities = pending.length;
  const uniqueLookups = groups.size;

  // ---------- Step 4: resolve each unique key once, in parallel. ----------
  let placesHits = 0;
  let fallbackHits = 0;

  await Promise.all(
    Array.from(groups.entries()).map(async ([normalizedKey, occurrences]) => {
      const first = occurrences[0];
      let url: string | null = null;
      try {
        url = await resolveActivityImage(first.name, destination || "", normalizedKey);
      } catch (err) {
        console.error(`[Activity Images] Resolve error for "${first.name}":`, err);
      }

      // ---------- Step 5: fan out the resolved URL (or fallback) ----------
      if (url) {
        placesHits++;
        for (const occ of occurrences) {
          occ.activity.image_url = url;
        }
      } else {
        // Places returned nothing — fall back to curated per-activity.
        // Each occurrence keeps the same fallback because its name+type match.
        fallbackHits++;
        const fallback = curatedFor(first.name, first.type);
        for (const occ of occurrences) {
          occ.activity.image_url = fallback;
        }
      }
    })
  );

  const duration = Date.now() - startTime;
  console.log(
    `[Activity Images] Resolved ${totalActivities} activities via ${uniqueLookups} unique lookups ` +
    `(${placesHits} places, ${fallbackHits} fallback) in ${duration}ms`
  );

  return days;
}
