/**
 * The Google Places calls behind activity photos: the Text Search that finds an
 * activity's place_id, and the Place Details calls for a place's photos (and,
 * for a place seen for the first time, its name and point). Each call is
 * logged at the price of its SKU. The caches around them are in
 * lib/images/activity.ts.
 */
import { placesCostForCall } from "@/lib/api-gateway/places-sku";
import { logApiCall } from "@/lib/api-gateway";

// The field masks drive Google's SKU (lib/api-gateway/places-sku.ts): asking
// for the place_id alone, and for photos alone, keeps both calls in the free
// IDs Only tiers.
const ACTIVITY_SEARCH_FIELD_MASK = "places.id";
const PHOTOS_FIELD_MASK = "photos";
// A new place's photo comes with its name and point, so a photo of another
// place is never shown (isAnotherPlace). That is the Pro tier, in Google's free
// allowance at the rate new places are looked up.
const PLACE_FIELD_MASK = "photos,displayName,location";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

/**
 * Place data we extract from the Places API + persist to `places_v2`.
 * Stored verbatim so future feature work (e.g. enriching itinerary coords with
 * verified Google lat/lng, swapping to Maps Grounding Lite, surfacing official
 * addresses on the trip detail page) can read straight from the cache row.
 */
export interface PlaceRecord {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  photo_resource_name: string | null;
  photo_url: string | null;
}

/**
 * One Text Search: the places Google found for `body`, or null when there is
 * no key or the call failed. Every call is logged under `endpoint` (callers
 * reach this only on a cache miss), priced by the SKU its field mask selects;
 * a call Google refused or never answered is not billed, so it logs at $0.
 * Fire-and-forget logging, so it never adds latency. The key is read per call.
 */
export async function textSearch<Place>(
  body: Record<string, unknown>,
  fieldMask: string,
  endpoint: string,
  signal?: AbortSignal
): Promise<Place[] | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  if (!key) return null;
  const startedAt = Date.now();
  let httpStatus = 0;
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify(body),
      signal,
    });
    httpStatus = response.status;
    if (!response.ok) return null;
    return ((await response.json()) as { places?: Place[] }).places ?? [];
  } catch {
    return null;
  } finally {
    void logApiCall({
      apiName: "google_places_search",
      endpoint,
      status: httpStatus || 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: httpStatus >= 200 && httpStatus < 300 ? placesCostForCall({ kind: "textSearch", fieldMask }).usd : 0,
      exactCost: true,
    });
  }
}

/**
 * Text Search for one activity's place_id, and nothing else: the place_id is
 * all the lookup uses, and asking for it alone is free. The photo is a
 * separate Place Details call by place_id (fetchPlacePhoto), so a place already
 * cached under another name skips it and a stale photo ref is refreshed
 * without searching again. Unique activities resolve in parallel, so the extra
 * roundtrip adds latency once per trip, not once per activity.
 *
 * The record is named after the activity (`name`) rather than Google's
 * listing, and carries no address or coordinates.
 *
 * Returns null when Google found no place, undefined when the call failed.
 */
export async function searchPlaceId(query: string, name: string = query): Promise<PlaceRecord | null | undefined> {
  if (!GOOGLE_PLACES_API_KEY) {
    return undefined;
  }

  // Any field beyond the place_id would move the whole call to a paid SKU
  // (see places-sku.ts); fetchPlacePhoto gets the photo, only when needed.
  const places = await textSearch<{ id?: string }>(
    { textQuery: query, maxResultCount: 1 },
    ACTIVITY_SEARCH_FIELD_MASK,
    "places:searchText (activity)"
  );
  if (!places) {
    return undefined;
  }

  const place = places[0];
  if (!place?.id) {
    return null;
  }

  // Partial record — place_id only, no photo yet (the caller fills it).
  return {
    place_id: place.id,
    display_name: name,
    formatted_address: null,
    latitude: null,
    longitude: null,
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
 *
 * `photoIndex` starts the search at that position in the place's photo list,
 * so a gallery tile heals to its own photo rather than the first one.
 */
export async function fetchPlacePhoto(
  placeId: string,
  opts: { endpointLabel?: string; photoIndex?: number } = {}
): Promise<{ photo_resource_name: string; photo_url: string } | null> {
  const photos = await fetchPlacePhotos(placeId, opts);
  return photos ? pickPlacePhoto(photos, opts.photoIndex) : null;
}

/** One entry of a place's photo list; `name` is the photo resource name. */
export type PlacePhoto = { name?: string };

/**
 * The Place Details call behind fetchPlacePhoto: the place's whole photo list
 * (up to 10), or null when the call fails. One call serves every photo of a
 * place, so callers that need several can share it.
 */
export async function fetchPlacePhotos(
  placeId: string,
  opts: { endpointLabel?: string } = {}
): Promise<PlacePhoto[] | null> {
  // Asking ONLY for `photos` — the minimum to get a photo_resource_name.
  const details = await placeDetails(placeId, PHOTOS_FIELD_MASK, opts.endpointLabel);
  return details ? (Array.isArray(details.photos) ? (details.photos as PlacePhoto[]) : []) : null;
}

/** A newly found place: its first usable photo, and Google's name and point for it. */
export async function fetchNewPlace(placeId: string): Promise<{
  photo: { photo_resource_name: string; photo_url: string } | null;
  display_name: string | null;
  point: { latitude: number; longitude: number } | null;
} | null> {
  const details = await placeDetails(placeId, PLACE_FIELD_MASK);
  if (!details) return null;
  const at = details.location as { latitude?: unknown; longitude?: unknown } | undefined;
  const name = (details.displayName as { text?: unknown } | undefined)?.text;
  return {
    photo: pickPlacePhoto(Array.isArray(details.photos) ? (details.photos as PlacePhoto[]) : []),
    display_name: typeof name === "string" && name ? name : null,
    point:
      typeof at?.latitude === "number" && typeof at.longitude === "number"
        ? { latitude: at.latitude, longitude: at.longitude }
        : null,
  };
}

/** One Place Details call for these fields: Google's answer, or null when it failed. */
async function placeDetails(
  placeId: string,
  fieldMask: string,
  endpointLabel = "places/{id}:photos (activity)"
): Promise<Record<string, unknown> | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }
  const startedAt = Date.now();
  let httpStatus = 0;

  try {
    const detailsResponse = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": fieldMask,
        },
      }
    );
    httpStatus = detailsResponse.status;

    if (!detailsResponse.ok) {
      return null;
    }

    return (await detailsResponse.json()) as Record<string, unknown>;
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
      endpoint: endpointLabel,
      status: httpStatus || 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: placesCostForCall({ kind: "details", fieldMask }).usd,
      exactCost: true,
    });
  }
}

/** The first usable photo from `photoIndex` on, with its proxy URL. */
export function pickPlacePhoto(
  photos: PlacePhoto[],
  photoIndex = 0
): { photo_resource_name: string; photo_url: string } | null {
  // Minimum hash length empirically distinguishes "this resource name
  // works at /media" from "Google returned a token that 400s". Full
  // hashes are typically 300-450 chars; pathological ones run ~80-120.
  const MIN_PHOTO_TOKEN_LEN = 200;
  const usable = (p: PlacePhoto) => typeof p?.name === "string" && p.name.length >= MIN_PHOTO_TOKEN_LEN;
  // Take the first photo whose name is long enough to be a real token, not
  // just [0]: Place Details sometimes returns short names that /media
  // rejects with a 400, which renders as a broken image. From `photoIndex`
  // onwards; a list shorter than that falls back to the first.
  const photoResourceName: string | null =
    (photos.slice(photoIndex).find(usable) ?? photos.find(usable))?.name ?? null;

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
}
