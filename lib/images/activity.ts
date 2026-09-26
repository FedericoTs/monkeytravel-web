import { placesCostForCall } from "@/lib/api-gateway/places-sku";
// The field masks drive Google's SKU (lib/api-gateway/places-sku.ts): the
// activity lookup is Text Search Pro, the photo fetch is Details Essentials.
const ACTIVITY_SEARCH_FIELD_MASK = "places.id,places.displayName,places.location,places.formattedAddress";
const PHOTOS_FIELD_MASK = "photos";
/**
 * Server-side activity image fetching. The generate routes call it before
 * responding, so images are in the itinerary before the user can save it.
 *
 * Results are cached per Google place_id in places_v2 (Google's terms allow
 * storing place_ids indefinitely), and places_v2_lookup maps each normalized
 * spelling of a name ("Colosseum", "Il Colosseo") to its place_id. The older
 * name-keyed `place_search` / `activity_image` cache remains as a fallback.
 */

import { cache } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiCall } from "@/lib/api-gateway";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// TTL of the legacy name-keyed cache in resolveActivityImage. The photo names
// in its URLs expire far sooner (see PHOTO_REF_MAX_AGE_DAYS); keep it long
// anyway: /api/places/photo self-heals a dead name at render from the place_id
// inside it, and a shorter TTL would multiply the paid Places calls this cache
// exists to avoid.
const ACTIVITY_IMAGE_CACHE_DAYS = 365;

// Cost control: default cap on paid Places resolutions per fetchActivityImages
// call (callers can pass maxPaidLookups). One resolution is one cache-miss
// activity: up to two Text Searches and a Place Details. Cache hits don't
// count, and the legacy fallback in resolveActivityImage can pay without
// counting. Once spent, the remaining fresh activities get curated fallbacks:
// lower is cheaper, higher gives more real photos.
const MAX_PAID_PLACE_LOOKUPS_PER_TRIP = 4;

// Paid-lookup budget for save-time enrichment (/api/trips/[id]/enrich-photos,
// lib/images/enrichTrip.ts). Trip generation makes no paid lookups: each
// activity gets a free cache-hit photo or a curated fallback. Real photos are
// resolved once a trip is saved, so generations nobody saves cost nothing.
export const SAVE_TIME_PAID_LOOKUPS = 8;

// Google expires photo resource names after about 29 days (measured). 21 days
// leaves about a week of margin: refreshing sooner spends Places quota on refs
// that still work; later risks handing a new trip a ref that is already dead.
const PHOTO_REF_MAX_AGE_DAYS = 21;

// places_v2 rows never expire, so cache hits often carry photo refs older than
// PHOTO_REF_MAX_AGE_DAYS. Refreshing all of them would add unbounded paid calls
// to one request, so each fetchActivityImages call refreshes at most this many
// and /api/places/photo self-heals the rest on first view. Deliberately small:
// the aim is to keep the cache from rotting, not to repair it in one pass.
const PHOTO_REFRESH_PER_TRIP = 2;

// Kill switch for activity photo lookups: on unless
// PLACES_ACTIVITY_PHOTOS_ENABLED is "false". Off, activities get curated
// fallbacks and lose nothing else (resolved coords never reach the itinerary);
// the destination hero in /api/places is separate. Generation is free either
// way (maxPaidLookups: 0), so the spend it gates is enrichment and day
// regeneration. Keep it on only while both staleness guards exist: the
// PHOTO_REF_MAX_AGE_DAYS refresh and the /api/places/photo self-heal.
const RESOLVE_ACTIVITY_PHOTOS =
  process.env.PLACES_ACTIVITY_PHOTOS_ENABLED !== "false";

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
 * Text Search for one activity: place_id, name, address and coords, but no
 * photo. The photo is a separate Place Details call by place_id
 * (fetchPlacePhoto), so a place already cached under another name skips it and
 * a stale photo ref is refreshed without searching again. Unique activities
 * resolve in parallel, so the extra roundtrip adds latency once per trip, not
 * once per activity.
 *
 * An ID-only Text Search plus Details may be cheaper; see the
 * text_search_essentials note in places-sku.ts before changing the masks.
 *
 * Returns null on failure or no match.
 */
async function searchPlaceId(query: string): Promise<PlaceRecord | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }

  let place: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  } | null = null;
  const startedAt = Date.now();
  let httpStatus = 0;

  // ---------- Text Search ----------
  // No photos in this mask: fetchPlacePhoto gets them, only when needed. The
  // priciest field sets the SKU of the whole call (see places-sku.ts).
  try {
    const searchResponse = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": ACTIVITY_SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 1,
        }),
      }
    );
    httpStatus = searchResponse.status;

    if (!searchResponse.ok) {
      return null;
    }

    const data = await searchResponse.json();
    place = data.places?.[0] ?? null;
  } catch {
    return null;
  } finally {
    // Every call here is paid: cache hits return before this function is
    // reached. Fire-and-forget so logging never adds latency to the lookup.
    void logApiCall({
      apiName: "google_places_search",
      endpoint: "places:searchText (activity)",
      status: httpStatus || 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: placesCostForCall({ kind: "textSearch", fieldMask: ACTIVITY_SEARCH_FIELD_MASK }).usd,
    });
  }

  if (!place?.id) {
    return null;
  }

  // Partial record — place_id + metadata, no photo yet (the caller fills it).
  return {
    place_id: place.id,
    display_name: place.displayName?.text ?? query,
    formatted_address: place.formattedAddress ?? null,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    photo_resource_name: null,
    photo_url: null,
  };
}

/**
 * Place Details for a known place_id, asking only for photos, and the proxy
 * URL for the first usable one. Separate from the search so a place already
 * cached by place_id skips this paid call, and a stale photo ref can be
 * refreshed by place_id alone.
 *
 * `endpointLabel` lets a caller attribute the spend (the render-time self-heal
 * in /api/places/photo passes its own) so api_request_logs can tell heals from
 * enrichment passes. The apiName and the cost never change.
 */
export async function fetchPlacePhoto(
  placeId: string,
  opts: { endpointLabel?: string } = {}
): Promise<{ photo_resource_name: string; photo_url: string } | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }
  const startedAt = Date.now();
  let httpStatus = 0;

  // Asking ONLY for `photos` — the minimum to get a photo_resource_name.
  try {
    const detailsResponse = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": PHOTOS_FIELD_MASK,
        },
      }
    );
    httpStatus = detailsResponse.status;

    if (!detailsResponse.ok) {
      return null;
    }

    const detailsData = await detailsResponse.json();
    // Take the first photo whose name is long enough to be a real token, not
    // just [0]: Place Details sometimes returns short names that /media
    // rejects with a 400, which renders as a broken image. The response holds
    // up to 10 photos, so skipping costs no extra Places call.
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

    if (!photoResourceName) {
      return null;
    }

    // Browsers can't load Google's /media URLs or the lh3.googleusercontent.com
    // URLs they redirect to (both return 504), so photos go through our
    // proxy, which fetches server-side and sets CDN cache headers.
    return {
      photo_resource_name: photoResourceName,
      photo_url: `/api/places/photo?name=${encodeURIComponent(photoResourceName)}&w=600&h=400`,
    };
  } catch (err) {
    // Photo fetch failed — log but don't fail the whole resolution.
    console.warn(
      `[places_v2] Place Details (photos) failed for ${placeId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    void logApiCall({
      apiName: "google_places_details",
      endpoint: opts.endpointLabel ?? "places/{id}:photos (activity)",
      status: httpStatus || 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: placesCostForCall({ kind: "details", fieldMask: PHOTOS_FIELD_MASK }).usd,
    });
  }
}

/**
 * Full resolve (Text Search + Place Details). Preserved for the legacy
 * `fetchFromGooglePlaces` wrapper. The primary path (getOrFetchPlace) calls
 * the two stages separately so it can dedup by place_id between them.
 */
async function fetchPlaceFromGoogle(query: string): Promise<PlaceRecord | null> {
  const partial = await searchPlaceId(query);
  if (!partial) {
    return null;
  }
  const photo = await fetchPlacePhoto(partial.place_id);
  if (photo) {
    partial.photo_resource_name = photo.photo_resource_name;
    partial.photo_url = photo.photo_url;
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
 * then fire-and-forget hit_count updates. No Places spend unless the photo
 * ref is stale (step 1b).
 *
 * Cache MISS path: Text Search (then name-only if that finds nothing), plus
 * Place Details for the photo unless places_v2 already has this place_id with
 * a photo (step 2b), then upsert the new rows. A repeat of the same name is a
 * cache hit; a new spelling of a known place pays only for the Text Search.
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
  normalizedKey: string,
  paidBudget: { remaining: number },
  photoRefreshBudget: { remaining: number }
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
      // Visibility: a free cache hit (0 Places spend). Logged so the cost
      // dashboard can compute a real activity-image cache-hit rate.
      void logApiCall({
        apiName: "google_places_search",
        endpoint: "places:searchText (activity, cache hit)",
        status: 200,
        responseTimeMs: 0,
        cacheHit: true,
        costUsd: 0,
      });

      // ---------- 1b. Photo-ref freshness ----------
      // The row never expires, but its photo ref dies after about 29 days (see
      // PHOTO_REF_MAX_AGE_DAYS); without this check a cache hit hands a new
      // trip a dead ref. This makes a few cache hits paid, capped by
      // photoRefreshBudget, which is separate from paidBudget so refreshes
      // never starve new activities.
      const refAgeMs = cached.updated_at
        ? Date.now() - Date.parse(cached.updated_at)
        : Number.POSITIVE_INFINITY;
      const refIsStale = refAgeMs > PHOTO_REF_MAX_AGE_DAYS * 86_400_000;

      if (cached.photo_resource_name && refIsStale && photoRefreshBudget.remaining > 0) {
        photoRefreshBudget.remaining--;
        const fresh = await fetchPlacePhoto(cached.place_id);
        if (fresh) {
          void supabase
            .from("places_v2")
            .update({
              photo_resource_name: fresh.photo_resource_name,
              photo_url: fresh.photo_url,
              updated_at: new Date().toISOString(),
            })
            .eq("place_id", cached.place_id);
          return { ...cached, ...fresh } as PlaceRecord;
        }
        // Refresh failed (Google down, place lost its photos). Fall through
        // with the stale ref — the render-time self-heal gets another shot.
      }

      return cached as PlaceRecord;
    }
  }

  // ---------- 2. Cache MISS path: resolve the place_id first ----------
  // Paid-lookup budget gate; cache hits above never spend it. Once exhausted,
  // return null so the caller serves a curated fallback. Check-then-decrement
  // is synchronous (no await between them), so under Promise.all at most N
  // activities get past this gate.
  if (paidBudget.remaining <= 0) {
    return null;
  }
  paidBudget.remaining--;

  // Text Search gives the canonical place_id. Query `${name} ${destination}`
  // first (matches local landmarks better), then the name alone.
  let partial: PlaceRecord | null = null;
  if (destination) {
    partial = await searchPlaceId(`${name} ${destination}`);
  }
  if (!partial) {
    partial = await searchPlaceId(name);
  }
  if (!partial) {
    return null;
  }

  // ---------- 2b. place_id dedup ----------
  // Name variants ("Colosseum" / "Il Colosseo" / "The Roman Colosseum") share
  // one place_id, but the lookup above only matches identical normalized
  // names. With the place_id from Text Search, check places_v2 directly: if
  // it already has a photo, skip the Place Details call and just record the
  // new lookup.
  const { data: existingRow } = await supabase
    .from("places_v2")
    .select("*")
    .eq("place_id", partial.place_id)
    .maybeSingle();

  let place: PlaceRecord;
  if (existingRow?.photo_url) {
    place = existingRow as PlaceRecord;
    // Visibility: a Place Details call we DIDN'T have to pay for.
    void logApiCall({
      apiName: "google_places_details",
      endpoint: "places/{id}:photos (activity, place_id dedup)",
      status: 200,
      responseTimeMs: 0,
      cacheHit: true,
      costUsd: 0,
    });
  } else {
    // Unknown place (or cached without a photo) — pay for the photo and
    // upsert the full row.
    const photo = await fetchPlacePhoto(partial.place_id);
    if (photo) {
      partial.photo_resource_name = photo.photo_resource_name;
      partial.photo_url = photo.photo_url;
    }
    place = partial;
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
  }

  // ---------- 3. Record the name → place_id lookup (idempotent) ----------
  // So the next request for THIS exact name variant is a free lookup hit.
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
 * Photo URL for a free-text query via Text Search + Place Details, without
 * reading or writing places_v2. Only the legacy fallback in
 * resolveActivityImage uses it.
 *
 * @deprecated Prefer `getOrFetchPlace(name, destination, normalizedKey)`.
 */
async function fetchFromGooglePlaces(query: string): Promise<string | null> {
  const place = await fetchPlaceFromGoogle(query);
  return place?.photo_url ?? null;
}

// Curated fallback images by activity type.
//
// Look at every image before adding it; a resolution check is not enough:
// Pexels search returns wrong places, and its grey "missing image" placeholder
// is served with HTTP 200, so both pass such checks (see the note in
// app/api/images/destination/route.ts).
//
// A type fallback must not be a recognisable landmark, or a Belgian itinerary
// can show the Colosseum next to the Belfry of Bruges. Use anonymous old-town
// streets and architectural detail; famous monuments belong only in the
// per-destination map.
//
// Pool depth matters as much as type coverage: a shallow pool repeats the
// same photo within one trip. Every type has its own reviewed pool of at least
// MIN_POOL, so the widening in getCuratedImage is only a safety net.
const CURATED_BY_TYPE: Record<string, string[]> = {
  restaurant: [
    "https://images.pexels.com/photos/10135114/pexels-photo-10135114.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11794317/pexels-photo-11794317.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12181619/pexels-photo-12181619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13869884/pexels-photo-13869884.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17206102/pexels-photo-17206102.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1872889/pexels-photo-1872889.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10135116/pexels-photo-10135116.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10148448/pexels-photo-10148448.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14885437/pexels-photo-14885437.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15189511/pexels-photo-15189511.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15372564/pexels-photo-15372564.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  foodie: [
    "https://images.pexels.com/photos/1327393/pexels-photo-1327393.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15390222/pexels-photo-15390222.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15671371/pexels-photo-15671371.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15671411/pexels-photo-15671411.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1639559/pexels-photo-1639559.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17989471/pexels-photo-17989471.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18015000/pexels-photo-18015000.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19671300/pexels-photo-19671300.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/23644633/pexels-photo-23644633.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  attraction: [
    "https://images.pexels.com/photos/11487781/pexels-photo-11487781.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12652452/pexels-photo-12652452.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14368431/pexels-photo-14368431.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15443208/pexels-photo-15443208.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16350875/pexels-photo-16350875.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/28843295/pexels-photo-28843295.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/29026217/pexels-photo-29026217.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/30967258/pexels-photo-30967258.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cultural: [
    "https://images.pexels.com/photos/10975757/pexels-photo-10975757.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13304717/pexels-photo-13304717.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13626838/pexels-photo-13626838.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13722612/pexels-photo-13722612.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19081217/pexels-photo-19081217.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19766571/pexels-photo-19766571.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/26974693/pexels-photo-26974693.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/28663466/pexels-photo-28663466.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/30319260/pexels-photo-30319260.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nature: [
    "https://images.pexels.com/photos/10548535/pexels-photo-10548535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10781049/pexels-photo-10781049.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11163057/pexels-photo-11163057.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13678556/pexels-photo-13678556.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20463880/pexels-photo-20463880.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2158824/pexels-photo-2158824.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15527528/pexels-photo-15527528.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16871285/pexels-photo-16871285.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15724087/pexels-photo-15724087.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  adventure: [
    "https://images.pexels.com/photos/11845063/pexels-photo-11845063.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12753943/pexels-photo-12753943.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13828102/pexels-photo-13828102.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14040199/pexels-photo-14040199.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1453488/pexels-photo-1453488.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16627598/pexels-photo-16627598.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1687514/pexels-photo-1687514.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18193574/pexels-photo-18193574.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17809080/pexels-photo-17809080.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  museum: [
    "https://images.pexels.com/photos/13432768/pexels-photo-13432768.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15138850/pexels-photo-15138850.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15988007/pexels-photo-15988007.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1604991/pexels-photo-1604991.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1666667/pexels-photo-1666667.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1671016/pexels-photo-1671016.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17218992/pexels-photo-17218992.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19968227/pexels-photo-19968227.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2328867/pexels-photo-2328867.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  urban: [
    "https://images.pexels.com/photos/1115262/pexels-photo-1115262.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12345917/pexels-photo-12345917.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1269791/pexels-photo-1269791.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13069726/pexels-photo-13069726.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14570978/pexels-photo-14570978.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14757444/pexels-photo-14757444.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16241095/pexels-photo-16241095.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17091398/pexels-photo-17091398.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  market: [
    "https://images.pexels.com/photos/104884/pexels-photo-104884.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10697692/pexels-photo-10697692.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10828209/pexels-photo-10828209.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11355644/pexels-photo-11355644.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11905679/pexels-photo-11905679.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17341188/pexels-photo-17341188.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18911914/pexels-photo-18911914.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18936011/pexels-photo-18936011.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  // Type strings the generator emits that reuse another type's pool; without
  // a key they would fall through to the generic widening.
  nature_attraction: [],   // filled below from `nature`
  cultural_attraction: [], // filled below from `cultural`
  food: [
    "https://images.pexels.com/photos/10054915/pexels-photo-10054915.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11066890/pexels-photo-11066890.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12955891/pexels-photo-12955891.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13788768/pexels-photo-13788768.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13823417/pexels-photo-13823417.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/154145/pexels-photo-154145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1703272/pexels-photo-1703272.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17902588/pexels-photo-17902588.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19781592/pexels-photo-19781592.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cafe: [
    "https://images.pexels.com/photos/1137745/pexels-photo-1137745.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11696469/pexels-photo-11696469.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12704634/pexels-photo-12704634.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14994661/pexels-photo-14994661.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15105621/pexels-photo-15105621.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18721993/pexels-photo-18721993.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20454106/pexels-photo-20454106.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2067431/pexels-photo-2067431.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2067552/pexels-photo-2067552.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  bar: [
    "https://images.pexels.com/photos/10356139/pexels-photo-10356139.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11538286/pexels-photo-11538286.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11538601/pexels-photo-11538601.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12176277/pexels-photo-12176277.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13030526/pexels-photo-13030526.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14866145/pexels-photo-14866145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15290564/pexels-photo-15290564.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17119947/pexels-photo-17119947.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  landmark: [
    "https://images.pexels.com/photos/10706954/pexels-photo-10706954.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14808854/pexels-photo-14808854.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17706482/pexels-photo-17706482.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18331722/pexels-photo-18331722.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18463801/pexels-photo-18463801.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/27791779/pexels-photo-27791779.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/27975700/pexels-photo-27975700.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/28999565/pexels-photo-28999565.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  park: [
    "https://images.pexels.com/photos/13399314/pexels-photo-13399314.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14300713/pexels-photo-14300713.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14634845/pexels-photo-14634845.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17401148/pexels-photo-17401148.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18425557/pexels-photo-18425557.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19310067/pexels-photo-19310067.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19788574/pexels-photo-19788574.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/24538661/pexels-photo-24538661.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  activity: [
    "https://images.pexels.com/photos/10278819/pexels-photo-10278819.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10736818/pexels-photo-10736818.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1088709/pexels-photo-1088709.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10933403/pexels-photo-10933403.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11357839/pexels-photo-11357839.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11850545/pexels-photo-11850545.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12282461/pexels-photo-12282461.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14021071/pexels-photo-14021071.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14705559/pexels-photo-14705559.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15172901/pexels-photo-15172901.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  shopping: [
    "https://images.pexels.com/photos/12770245/pexels-photo-12770245.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12791209/pexels-photo-12791209.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13025991/pexels-photo-13025991.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13282014/pexels-photo-13282014.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13532891/pexels-photo-13532891.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14875546/pexels-photo-14875546.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15054264/pexels-photo-15054264.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17645491/pexels-photo-17645491.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18260811/pexels-photo-18260811.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  entertainment: [
    "https://images.pexels.com/photos/10880677/pexels-photo-10880677.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12616961/pexels-photo-12616961.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12661846/pexels-photo-12661846.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12909317/pexels-photo-12909317.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19658083/pexels-photo-19658083.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/25857614/pexels-photo-25857614.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/26285734/pexels-photo-26285734.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nightlife: [
    "https://images.pexels.com/photos/11457826/pexels-photo-11457826.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14075145/pexels-photo-14075145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18799640/pexels-photo-18799640.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18976506/pexels-photo-18976506.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18976507/pexels-photo-18976507.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18983602/pexels-photo-18983602.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19651776/pexels-photo-19651776.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19923641/pexels-photo-19923641.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20074374/pexels-photo-20074374.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  spa: [
    "https://images.pexels.com/photos/1926811/pexels-photo-1926811.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/35884499/pexels-photo-35884499.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3681801/pexels-photo-3681801.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/4170175/pexels-photo-4170175.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/4974567/pexels-photo-4974567.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14929512/pexels-photo-14929512.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19980238/pexels-photo-19980238.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20705879/pexels-photo-20705879.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/23330922/pexels-photo-23330922.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3608965/pexels-photo-3608965.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/36420271/pexels-photo-36420271.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  wellness: [
    "https://images.pexels.com/photos/13811764/pexels-photo-13811764.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3822086/pexels-photo-3822086.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/38263127/pexels-photo-38263127.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/4327043/pexels-photo-4327043.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/5890296/pexels-photo-5890296.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/5992856/pexels-photo-5992856.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/6582580/pexels-photo-6582580.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/6643238/pexels-photo-6643238.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/6648552/pexels-photo-6648552.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  transport: [
    "https://images.pexels.com/photos/12367459/pexels-photo-12367459.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14552060/pexels-photo-14552060.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15460742/pexels-photo-15460742.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17315130/pexels-photo-17315130.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17499171/pexels-photo-17499171.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17967886/pexels-photo-17967886.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10342323/pexels-photo-10342323.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10994927/pexels-photo-10994927.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12568284/pexels-photo-12568284.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12671703/pexels-photo-12671703.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
};

CURATED_BY_TYPE.nature_attraction = CURATED_BY_TYPE.nature;
CURATED_BY_TYPE.cultural_attraction = CURATED_BY_TYPE.cultural;
const FALLBACK_IMAGES = [
  "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2087391/pexels-photo-2087391.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
];

/**
 * Get curated image for activity type
 */
const MIN_POOL = 6;

function getCuratedImage(type: string, index: number = 0): string {
  // Use the type's own pool when it is deep enough. Only a small pool is
  // widened with `attraction` + FALLBACK_IMAGES: widening every type would
  // splice generic old-town streets into `spa` or `nightlife`. Every known
  // type clears MIN_POOL, so in practice this widens only an unknown type
  // string, where generic scenery is the right answer.
  const own = CURATED_BY_TYPE[type.toLowerCase()] ?? [];
  const pool =
    own.length >= MIN_POOL
      ? own
      : [
          ...own,
          ...(CURATED_BY_TYPE["attraction"] ?? []),
          ...FALLBACK_IMAGES,
        ].filter((url, i, arr) => arr.indexOf(url) === i);
  return pool[index % pool.length] ?? FALLBACK_IMAGES[0];
}

/**
 * Stable curated-image picker based on activity name. Returns the same image
 * for the same name+type combo so a fallback hit is deterministic.
 */
export function curatedFor(name: string, type: string): string {
  // djb2, not a plain char-code sum: names in one trip share prefixes and
  // lengths ("Osteria da Fortunata", "Osteria Mario"), so their sums cluster
  // and collide on the same few slots of a small pool. Fewer repeats would
  // need distinct images assigned across a trip, which needs trip context
  // this function doesn't have.
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash * 33) ^ name.charCodeAt(i)) >>> 0;
  }
  return getCuratedImage(type || "attraction", hash);
}

/**
 * Activity type strings are `[a-z_]` in practice (`nature_attraction`,
 * `cultural_attraction`, …). Anything else is rejected on read rather than
 * sanitized — a type we don't recognise resolves to generic scenery anyway,
 * so there's nothing to gain from trying to salvage a malformed one.
 */
const TYPE_HINT_RE = /^[a-z_]{1,32}$/;

/** Read a `t=` type hint back off a proxy URL. Invalid/absent → "". */
export function readActivityTypeHint(raw: string | null | undefined): string {
  const t = (raw ?? "").toLowerCase();
  return TYPE_HINT_RE.test(t) ? t : "";
}

/**
 * Tag a `/api/places/photo` proxy URL with the activity type it was resolved
 * for, so that if Google's photo later dies the proxy can pick a fallback that
 * MATCHES the activity instead of generic scenery.
 *
 * Why the hint has to live in the URL: the proxy is addressed only by a Google
 * photo resource name, and the URL is what gets frozen into `trips.itinerary`
 * JSONB. There is no other channel — by the time the browser requests the
 * image, the activity that owns it is long out of scope.
 *
 * Why it is NOT set in `fetchPlacePhoto`: that result is cached per place_id in
 * `places_v2.photo_url`, and one place can back activities of different types
 * (a market that is `market` on one trip and `food` on another). Baking a type
 * into the cached row would let whichever trip resolved it first decide the
 * fallback for everyone. So the hint is attached HERE, per activity, at fan-out.
 *
 * No-op for anything that isn't our proxy — curated Pexels URLs are already
 * final and carry no place to hang a query param.
 */
export function withActivityTypeHint(url: string, type: string): string {
  if (!url.startsWith("/api/places/photo")) return url;
  const t = (type || "").toLowerCase();
  if (!TYPE_HINT_RE.test(t)) return url;
  // Never double-append: fetchActivityImages can re-run over an itinerary whose
  // URLs it already tagged (save-time enrichment re-walks generated trips).
  if (/[?&]t=/.test(url)) return url;
  return `${url}&t=${t}`;
}

/**
 * Move the `t=` hint from an old proxy URL onto its replacement.
 *
 * Needed because `places_v2.photo_url` is cached per PLACE and so carries no
 * hint: any code path that swaps a fresh canonical URL in over an old one (see
 * lib/places/refreshItineraryPhotos.ts) would otherwise strip the hint and
 * silently downgrade that activity's dead-photo fallback to generic scenery.
 *
 * Lives here rather than at the call site so all three hint operations share
 * one definition of what a hint looks like. No-op when the old URL has no hint
 * (URLs written before hints existed), when the replacement already carries
 * one, or when the replacement isn't our proxy.
 */
export function carryTypeHint(oldUrl: string | undefined | null, fresh: string): string {
  if (!oldUrl || !fresh.startsWith("/api/places/photo")) return fresh;
  if (/[?&]t=/.test(fresh)) return fresh;
  const hint = /[?&]t=([^&]*)/.exec(oldUrl)?.[1];
  return hint && TYPE_HINT_RE.test(hint) ? `${fresh}&t=${hint}` : fresh;
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
 * Resolve a single unique activity to a photo URL, or null for the caller's
 * curated fallback.
 *
 *   1. place_id-keyed cache via `getOrFetchPlace`. This is the primary path.
 *   2. LEGACY fallback: the name-keyed `place_search`/`activity_image` cache
 *      via `cache.withDatabase`, tried when the primary path yields no photo
 *      and paid budget remains.
 *
 * `cache.withDatabase` gives the legacy fallback in-memory + in-flight dedup.
 * The primary path doesn't need it because the per-request dedup happens
 * upstream in `fetchActivityImages` (same normalizedKey is resolved once per
 * call to `Promise.all`).
 */
async function resolveActivityImage(
  name: string,
  destination: string,
  normalizedKey: string,
  paidBudget: { remaining: number },
  photoRefreshBudget: { remaining: number }
): Promise<string | null> {
  // Kill switch: return null so the caller applies the curated fallback. Every
  // paid lookup fetchActivityImages makes passes through here. Activities that
  // already have a proxy URL never reach this function and keep it; rendering
  // them still bills downloads and self-heals in /api/places/photo.
  if (!RESOLVE_ACTIVITY_PHOTOS) {
    return null;
  }
  // ---------- Primary path: place_id-keyed cache ----------
  try {
    const place = await getOrFetchPlace(name, destination || "", normalizedKey, paidBudget, photoRefreshBudget);
    if (place?.photo_url) {
      return place.photo_url;
    }
  } catch (err) {
    // Network/DB errors fall through to the legacy cache — don't break the
    // user request because the new cache misbehaved.
    console.error("[Activity Images] place_id cache error, falling back:", err);
  }

  // Out of the per-trip paid budget → curated fallback. Don't fall through to
  // the legacy path, which can ALSO make a paid Google call.
  if (paidBudget.remaining <= 0) {
    return null;
  }

  // ---------- Legacy fallback path ----------
  // Serves name-keyed rows, including ones from before places_v2 existed and
  // cached "no photo" misses. On a miss its fetcher pays for Text Search +
  // Place Details without spending paidBudget, and caches the result (even a
  // null) for ACTIVITY_IMAGE_CACHE_DAYS.
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
 * Used by the generate routes to populate images before responding.
 *
 * Dedup strategy:
 *   1. Flatten every activity across every day.
 *   2. Skip any that already have a KNOWN-GOOD `image_url`.
 *   3. Group by normalized key — same key → same Places lookup.
 *   4. Resolve each UNIQUE key exactly once in parallel.
 *   5. Fan the resolved URL back out to every activity that shared that key.
 *
 * Known-good means our `/api/places/photo` proxy or a curated Pexels/Unsplash
 * URL. Gemini sometimes writes raw Google photo URLs (places.googleapis.com,
 * maps.googleapis.com) into its output, and those fail (403/404) in the
 * browser, so anything else is stripped and re-resolved.
 *
 * A trip with "Colosseum" on day 2 and day 5 makes one lookup, not two; a
 * later trip with the same name and destination hits places_v2_lookup.
 *
 * @param days - Array of itinerary days with activities
 * @param destination - Trip destination for context
 * @returns The same days array with image_url populated on each activity
 */
export async function fetchActivityImages<T extends { activities: ActivityWithImage[] }>(
  days: T[],
  destination: string,
  opts: { maxPaidLookups?: number; reresolveCurated?: boolean } = {}
): Promise<T[]> {
  const startTime = Date.now();
  // How many PAID Google lookups this call may make. Generation passes 0
  // (free: cache hits + curated fallbacks only); the save-time enrichment
  // endpoint passes a generous budget so KEPT trips get real photos.
  const maxPaidLookups = opts.maxPaidLookups ?? MAX_PAID_PLACE_LOOKUPS_PER_TRIP;
  // When true, a curated stock fallback is treated as NOT-final and gets
  // re-resolved into a real place photo (used at save time to upgrade the
  // zero-cost curated images baked at generation). Real proxy URLs always stay.
  const reresolveCurated = opts.reresolveCurated ?? false;

  // ---------- Step 1+2: collect activities needing resolution. ----------
  // Each occurrence keeps a reference to its activity object so the URL is
  // written back in place.
  type Pending = {
    activity: ActivityWithImage;
    normalizedKey: string;
    name: string;
    type: string;
  };

  // Only the proxy URL pattern and our curated CDN fallbacks survive without
  // re-resolution. Everything else (raw Google URLs, stale, hallucinated)
  // gets cleared and forced through the pipeline below.
  const KNOWN_GOOD_URL_RE =
    /^(\/api\/places\/photo\?name=places%2F[A-Za-z0-9_-]+%2Fphotos%2F|\/api\/places\/photo\?name=places\/[A-Za-z0-9_-]+\/photos\/|https:\/\/images\.pexels\.com\/|https:\/\/images\.unsplash\.com\/)/;
  // Save-time mode: a real /api/places/photo proxy URL is final (keep it, never
  // re-pay), but a curated Pexels/Unsplash fallback is NOT final — re-resolve it
  // so a kept trip upgrades from stock to a real Google place photo if one exists.
  const PROXY_ONLY_URL_RE =
    /^(\/api\/places\/photo\?name=places%2F[A-Za-z0-9_-]+%2Fphotos%2F|\/api\/places\/photo\?name=places\/[A-Za-z0-9_-]+\/photos\/)/;
  const knownGoodRe = reresolveCurated ? PROXY_ONLY_URL_RE : KNOWN_GOOD_URL_RE;

  const pending: Pending[] = [];
  for (const day of days) {
    for (const activity of day.activities) {
      const existing = activity.image_url;
      if (existing && knownGoodRe.test(existing)) {
        continue; // already a usable URL — skip re-enrichment
      }
      // Strip any non-canonical URL (raw Google, etc.) so the resolver below
      // overwrites it cleanly even if Gemini gave us garbage.
      if (existing) activity.image_url = undefined;
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
  // Shared per-trip budget for PAID Google lookups (see
  // MAX_PAID_PLACE_LOOKUPS_PER_TRIP). Cache hits don't consume it; once it's
  // spent, the rest of this trip's fresh activities get curated fallbacks.
  const paidBudget = { remaining: maxPaidLookups };
  // Separate from paidBudget so a photo-ref refresh never eats the budget that
  // resolves new activities. Zero when maxPaidLookups is 0: trip generation
  // relies on that to cost nothing, and a refresh is a paid call. Zero-budget
  // calls keep whatever ref the cache has; /api/places/photo self-heals stale
  // ones at render.
  const photoRefreshBudget = {
    remaining: maxPaidLookups > 0 ? PHOTO_REFRESH_PER_TRIP : 0,
  };
  let placesHits = 0;
  let fallbackHits = 0;

  await Promise.all(
    Array.from(groups.entries()).map(async ([normalizedKey, occurrences]) => {
      const first = occurrences[0];
      let url: string | null = null;
      try {
        url = await resolveActivityImage(first.name, destination || "", normalizedKey, paidBudget, photoRefreshBudget);
      } catch (err) {
        console.error(`[Activity Images] Resolve error for "${first.name}":`, err);
      }

      // ---------- Step 5: fan out the resolved URL (or fallback) ----------
      if (url) {
        placesHits++;
        for (const occ of occurrences) {
          // Per-occurrence, not per-group: occurrences share a normalized NAME,
          // but nothing forces them to share a type, and the hint is only worth
          // carrying if it describes the activity it's attached to.
          occ.activity.image_url = withActivityTypeHint(url, occ.type);
        }
      } else {
        // No photo resolved: the whole group gets one curated fallback, picked
        // from the first occurrence's name and type.
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
