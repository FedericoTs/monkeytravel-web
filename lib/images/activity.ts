/**
 * Server-side activity image fetching
 * Used by AI generate API to fetch images before returning to client
 * This prevents the race condition where users save before images load
 *
 * 2026-05-31 dedup pass (task #339):
 * - Migrated the ad-hoc memory + DB cache to `cache.withDatabase('place_search', ...)`.
 * - Per-trip dedup by normalized name across all days.
 * - TTL extended from 30 days to 365 days.
 *
 * 2026-06-01 cost-reduction pass (task #367):
 * - NEW: place_id-keyed cache via places_v2 + places_v2_lookup tables. The
 *   normalized-name cache from 2026-05-31 only collapsed identical names
 *   ("Colosseum" + "Colosseum"). Real activity names drift between trips
 *   ("Colosseum" / "Il Colosseo" / "The Roman Colosseum" / "Coliseum"). Each
 *   variant was a fresh Places API call at $32/1K Pro SKU + $7/1K photo.
 * - The new layer adds a many-to-one mapping: every name variant ever seen
 *   resolves to a single Google place_id, and place_ids cache indefinitely
 *   (Google TOS exempts them from the cache-expiry rule).
 * - Field mask expanded from `places.photos` only → `places.id,
 *   places.displayName,places.location,places.formattedAddress,places.photos`.
 *   Same Pro SKU billing on the fresh call but ~4× more useful data — we now
 *   get real Google coordinates that future work can use to override Gemini's
 *   hallucinated lat/lng.
 * - Expected steady-state cost reduction: 60-80% depending on traffic mix
 *   (higher for repeat-destination users, lower for unique-place foodie trips).
 * - Backward compatible: old `place_search` / `activity_image` cache rows still
 *   serve traffic until they expire; new lookups populate places_v2 in
 *   parallel. No migration of historical rows.
 */

import { cache } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

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
 * Place data we extract from the Places API + persist to `places_v2`.
 * Stored verbatim so future feature work (e.g. enriching itinerary coords with
 * verified Google lat/lng, swapping to Maps Grounding Lite, surfacing official
 * addresses on the trip detail page) can read straight from the cache row.
 */
interface PlaceRecord {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  photo_resource_name: string | null;
  photo_url: string | null;
}

/**
 * Resolve a query string into a full PlaceRecord via the cheapest
 * possible Google Places API combination.
 *
 * 2026-06-01 SKU optimization (task #367 phase 2):
 *
 * Previously this was ONE call to Text Search with `places.photos` in
 * the field mask — which forces Google to bill the call as "Text Search
 * Pro" ($32/1K). That was the simplest path but the most expensive.
 *
 * The new 2-call sequence is ~26% cheaper per fresh lookup:
 *
 *   Step 1: Text Search **Essentials** (id + displayName + location +
 *           formattedAddress; NO photos). Billed as the Essentials SKU
 *           at $5/1K — 6.4× cheaper than Pro for the same identity fields.
 *
 *   Step 2: Place **Details Pro** by place_id, asking ONLY for `photos`.
 *           Billed at $17/1K. Required because the Photos endpoint needs
 *           a photo_resource_name, and the only way to get one (without
 *           paying for Pro Text Search) is via Place Details Pro.
 *
 *   Step 3 (out of band, on render): Place **Photos** at $7/1K — handled
 *           by the existing `/api/places/photo` proxy. Cached by Vercel
 *           edge for 1 year.
 *
 *   Total fresh lookup: $5 + $17 = $22/1K + $7/1K photo = $29/1K
 *   vs. old single call: $32 + $7 = $39/1K
 *   → 26% saving per fresh lookup, on top of the variant-dedup savings
 *     from the place_id cache.
 *
 * Why not skip Place Details and use Text Search IDs-Only ($1/1K)?
 *   IDs-Only returns ONLY place_id — no name, no coords. We'd still need
 *   Place Details Essentials ($5/1K) to get name+coords, then Place
 *   Details Pro ($17/1K) for photos. Net: $1 + $5 + $17 = $23/1K, only
 *   $1/1K better than the current path, and adds another roundtrip. Not
 *   worth the latency budget.
 *
 * Latency trade-off:
 *   +1 roundtrip per FRESH lookup (~150-250ms server-to-server inside
 *   GCP). CACHE-HIT lookups still pay 0 roundtrips. Per-trip impact is
 *   bounded by `Promise.all` in `fetchActivityImages` — every unique
 *   activity in a trip runs in parallel.
 *
 * Error handling:
 *   If Step 1 fails or returns no match → return null (caller falls back
 *   to legacy cache + curated images). If Step 1 succeeds but Step 2
 *   fails → return the PlaceRecord with `photo_resource_name: null` and
 *   `photo_url: null`. The place is still cached (id + name + coords);
 *   the photo can be re-fetched on a future trip.
 */
async function fetchPlaceFromGoogle(query: string): Promise<PlaceRecord | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }

  let place: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  } | null = null;

  // ---------- Step 1: Text Search Essentials ($5/1K) ----------
  // Field mask deliberately EXCLUDES `places.photos` to stay on the
  // Essentials SKU. Adding any Pro-tier field (photos, rating, etc.)
  // bumps the whole call to Pro pricing.
  try {
    const searchResponse = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.location,places.formattedAddress",
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
    place = data.places?.[0] ?? null;
  } catch {
    return null;
  }

  if (!place?.id) {
    return null;
  }

  // Build the partial record we can return even if photo fetch fails.
  const partial: PlaceRecord = {
    place_id: place.id,
    display_name: place.displayName?.text ?? query,
    formatted_address: place.formattedAddress ?? null,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    photo_resource_name: null,
    photo_url: null,
  };

  // ---------- Step 2: Place Details Pro ($17/1K) for photos ----------
  // Asking ONLY for `photos` — the minimum to get a photo_resource_name.
  // If this call fails (network blip, quota, billing issue) we still
  // return the partial record so the place is cached for future trips;
  // a later request can retry the photo (logic in getOrFetchPlace below).
  try {
    const detailsResponse = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(place.id)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "photos",
        },
      }
    );

    if (detailsResponse.ok) {
      const detailsData = await detailsResponse.json();
      // Walk the photos array (not just [0]) and pick the first one with
      // a resource name long enough to be a real Google photo token.
      // **2026-06-04 fix:** Google's Place Details Pro sometimes returns
      // photo entries whose `name` is shorter than the typical 300+ char
      // hash. Those names cause Google's /media endpoint to respond 400,
      // which streams down as a broken-image icon. Skipping short entries
      // and trying the next one (Google returns up to 10 photos) gets a
      // usable photo for nearly every place — at zero additional Places
      // API spend (the field mask already included all photos).
      const photos: Array<{ name?: string }> = Array.isArray(detailsData.photos)
        ? detailsData.photos
        : [];
      // Minimum hash length empirically distinguishes "this resource name
      // works at /media" from "Google returned a token that 400s". Full
      // hashes are typically 300-450 chars; pathological ones run ~80-120.
      const MIN_PHOTO_TOKEN_LEN = 200;
      const photoResourceName: string | null =
        photos.find((p) => typeof p?.name === "string" && p.name.length >= MIN_PHOTO_TOKEN_LEN)
          ?.name ?? null;

      if (photoResourceName) {
        // **2026-05-24 live-test fix (revision 2):** raw
        // `places.googleapis.com/v1/.../media?key=...` AND resolved
        // `lh3.googleusercontent.com/place-photos/...` URLs both 504 from
        // direct browser loads. Our `/api/places/photo` proxy fetches
        // them server-side and streams back with CDN-friendly cache
        // headers (1-year edge TTL).
        partial.photo_resource_name = photoResourceName;
        partial.photo_url = `/api/places/photo?name=${encodeURIComponent(photoResourceName)}&w=600&h=400`;
      }
    }
  } catch (err) {
    // Photo fetch failed — log but don't fail the whole resolution.
    console.warn(
      `[places_v2] Place Details (photos) failed for ${place.id}:`,
      err instanceof Error ? err.message : err
    );
  }

  return partial;
}

/**
 * place_id-keyed cache lookup + populate.
 *
 * Two tables:
 *   - `places_v2_lookup` — many normalized name keys → one place_id (the cheap
 *     row to check on every request)
 *   - `places_v2` — one row per Google place_id (full data; the row we want)
 *
 * Cache HIT path: 1 DB roundtrip via a single SELECT joining both tables,
 * then a fire-and-forget hit_count++ UPDATE. 0 Places API spend.
 *
 * Cache MISS path: 2 Places API calls billed at ($5 + $17)/1K = $22/1K
 * (Text Search Essentials + Place Details Pro, see `fetchPlaceFromGoogle`
 * for the SKU rationale), then upsert into both tables. Subsequent
 * lookups for ANY name variant resolving to the same place_id are free.
 *
 * In-flight dedup: handled at the `fetchActivityImages` group layer (same
 * normalizedKey resolves once per request) — we don't re-implement it here.
 *
 * Why service-role client: `places_v2` is server-side cache infra, RLS-locked
 * to service_role only (no anon access; no per-user data). The admin client
 * bypasses RLS as designed.
 */
async function getOrFetchPlace(
  name: string,
  destination: string,
  normalizedKey: string
): Promise<PlaceRecord | null> {
  const supabase = createAdminClient();

  // ---------- 1. Cache HIT path ----------
  // Single joined SELECT: lookup row → cached place row.
  const { data: hit, error: hitErr } = await supabase
    .from("places_v2_lookup")
    .select("place_id, places_v2(*)")
    .eq("normalized_key", normalizedKey)
    .maybeSingle();

  if (!hitErr && hit?.places_v2) {
    // `places_v2` is a 1:1 join → supabase-js returns the related row as an
    // object (or array depending on version). Normalize both shapes.
    const cached = Array.isArray(hit.places_v2) ? hit.places_v2[0] : hit.places_v2;
    if (cached) {
      // Fire-and-forget: bump hit_count + last_accessed timestamps on both
      // tables so future cache-warmth analytics can pick the popular spots.
      void supabase
        .from("places_v2_lookup")
        .update({
          hit_count: (cached.hit_count ?? 0) + 1,
          last_accessed_at: new Date().toISOString(),
        })
        .eq("normalized_key", normalizedKey);
      void supabase
        .from("places_v2")
        .update({
          hit_count: (cached.hit_count ?? 0) + 1,
          last_accessed_at: new Date().toISOString(),
        })
        .eq("place_id", cached.place_id);
      return cached as PlaceRecord;
    }
  }

  // ---------- 2. Cache MISS path — paid lookup ----------
  // Query order: `${name} ${destination}` first (matches local landmarks
  // better than the name alone). Fall back to name-only if the qualified
  // query misses.
  let place: PlaceRecord | null = null;
  if (destination) {
    place = await fetchPlaceFromGoogle(`${name} ${destination}`);
  }
  if (!place) {
    place = await fetchPlaceFromGoogle(name);
  }
  if (!place) {
    return null;
  }

  // ---------- 3. Persist to cache (both tables) ----------
  // Order matters: upsert places_v2 first (PK target of the FK), then the
  // lookup row. Both upserts are idempotent.
  const { error: placeErr } = await supabase.from("places_v2").upsert(
    {
      place_id: place.place_id,
      display_name: place.display_name,
      formatted_address: place.formatted_address,
      latitude: place.latitude,
      longitude: place.longitude,
      photo_resource_name: place.photo_resource_name,
      photo_url: place.photo_url,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "place_id" }
  );
  if (placeErr) {
    console.error("[places_v2] upsert place failed:", placeErr.message);
    // Don't fail the user request — we got the place data, just couldn't cache it.
    return place;
  }

  const { error: lookupErr } = await supabase.from("places_v2_lookup").upsert(
    {
      normalized_key: normalizedKey,
      place_id: place.place_id,
    },
    { onConflict: "normalized_key" }
  );
  if (lookupErr) {
    console.error("[places_v2_lookup] upsert lookup failed:", lookupErr.message);
  }

  return place;
}

/**
 * Backward-compat wrapper preserving the old `fetchFromGooglePlaces(query)`
 * surface. Callers that only need a photo URL keep working; the underlying
 * call now extracts more data and caches by place_id.
 *
 * @deprecated Prefer `getOrFetchPlace(name, destination, normalizedKey)`.
 */
async function fetchFromGooglePlaces(query: string): Promise<string | null> {
  const place = await fetchPlaceFromGoogle(query);
  return place?.photo_url ?? null;
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
 * Resolve a single unique activity to a photo URL.
 *
 * 2026-06-01 cache pipeline (cost-reduction pass):
 *   1. NEW: place_id-keyed cache via `getOrFetchPlace`. Many name variants
 *      collapse to one paid Places call ever. This is the primary path.
 *   2. LEGACY fallback: old `place_search`/`activity_image` cache wrapped via
 *      `cache.withDatabase`. Kept hot so historical rows continue serving
 *      until they age out (TTL 365d). Only invoked when the new path
 *      returns null (i.e. Places API truly couldn't find the place).
 *
 * The in-memory + in-flight dedup of `cache.withDatabase` still applies to
 * the legacy fallback. The new path doesn't need it because the per-request
 * dedup happens upstream in `fetchActivityImages` (same normalizedKey is
 * resolved once per call to `Promise.all`).
 */
async function resolveActivityImage(
  name: string,
  destination: string,
  normalizedKey: string
): Promise<string | null> {
  // ---------- Primary path: place_id-keyed cache ----------
  try {
    const place = await getOrFetchPlace(name, destination || "", normalizedKey);
    if (place?.photo_url) {
      return place.photo_url;
    }
  } catch (err) {
    // Network/DB errors fall through to the legacy cache — don't break the
    // user request because the new cache misbehaved.
    console.error("[Activity Images] place_id cache error, falling back:", err);
  }

  // ---------- Legacy fallback path ----------
  // Preserves the 30d-cached historical "no photo found" misses + serves
  // rows from before places_v2 existed. Will quietly retire as TTLs expire.
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
