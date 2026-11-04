/**
 * Server-side activity image fetching. The generate routes call it before
 * responding, so images are in the itinerary before the user can save it.
 *
 * Results are cached per Google place_id in places_v2 (Google's terms allow
 * storing place_ids indefinitely), and places_v2_lookup maps each normalized
 * spelling of a name ("Colosseum", "Il Colosseo") to its place_id. The older
 * name-keyed `place_search` / `activity_image` cache remains as a fallback.
 */

import { cache, generateCacheKey, getFromDatabase, saveToDatabase } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiCall, logApiCalls } from "@/lib/api-gateway";
import { fetchNewPlace, fetchPlacePhoto, searchPlaceId, type PlaceRecord } from "@/lib/places/google-places";
import { landmarkPhotos, type LandmarkLookup } from "@/lib/images/landmark-photos";
import { curatedFor, withActivityTypeHint } from "@/lib/images/curated";
import { distanceM, namesAgree, placeName } from "@/lib/images/wikimedia-landmark";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { isPlaceholderPoint } from "@/lib/trip/placeholder-point";

// TTL of the legacy name-keyed cache in resolveActivityImage. The photo names
// in its URLs expire far sooner (see PHOTO_REF_MAX_AGE_DAYS); keep it long
// anyway: /api/places/photo self-heals a dead name at render from the place_id
// inside it, and a shorter TTL would multiply the paid Places calls this cache
// exists to avoid.
const ACTIVITY_IMAGE_CACHE_DAYS = 365;

// How long a name Google found no place for is not searched again. Shorter
// than a found place: Google may list it later.
const NO_MATCH_DAYS = 90;

// Cost control: default cap on paid Places resolutions per fetchActivityImages
// call (callers can pass maxPaidLookups). One resolution is one cache-miss
// activity: up to two Text Searches and a Place Details. Cache hits don't
// count, and the legacy fallback in resolveActivityImage can pay without
// counting. Once spent, the remaining fresh activities get curated fallbacks:
// lower is cheaper, higher gives more real photos.
const MAX_PAID_PLACE_LOOKUPS_PER_TRIP = 4;

// Paid-lookup budget for kept-trip enrichment (/api/trips/[id]/enrich-photos,
// lib/images/enrichTrip.ts). Trip generation makes no paid lookups: each
// activity gets a free cache-hit photo or a curated fallback. Real photos are
// resolved when the owner opens a saved trip, so plans nobody keeps cost nothing.
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

// Free Wikimedia photos for places Wikidata knows (lib/images/landmark-photos.ts),
// tried before Google; on unless WIKIMEDIA_LANDMARK_PHOTOS is "false".
const LANDMARK_PHOTOS = process.env.WIKIMEDIA_LANDMARK_PHOTOS !== "false";
// New Wikimedia lookups per call, and how long a saved trip waits for them;
// lookups still running go on in the background for the next save.
const MAX_NEW_LANDMARKS = 12;
const LANDMARK_WAIT_MS = 5000;
// A plan being generated waits for none: every place is looked up in the
// background, and the planner picks the photos up (/api/images/landmarks).
const MAX_NEW_LANDMARKS_IN_BACKGROUND = 40;
// Activity types that are never a place with a photo of its own.
const NOT_A_PLACE_TYPES = new Set(["transport", "travel", "flight", "transfer", "accommodation", "hotel"]);
// Meals and drinks: the later parts of their names say where they are.
const MEAL_TYPES = new Set(["restaurant", "cafe", "bar", "food"]);

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

/** A places_v2 row as the lookup returns it. */
type CachedPlace = PlaceRecord & { updated_at?: string | null };

// The keys travel in the lookup's URL, so a very long trip is split into a
// few lookups rather than one URL longer than the proxies on the way accept.
const LOOKUP_URL_KEY_CHARS = 6000;

/**
 * The cached places_v2 row of every key that has one: one joined SELECT for
 * the whole trip. A lookup per activity, all fired at once, queued on the
 * database's small connection pool far longer than the queries ran. The hits
 * are logged in one insert and counted in one call, unless only the places'
 * names and coordinates are wanted (`countHits` false: no photo is served).
 */
async function lookupCachedPlaces(keys: string[], countHits = true): Promise<Map<string, CachedPlace>> {
  const supabase = createAdminClient();
  const batches: string[][] = [[]];
  let chars = 0;
  for (const key of keys) {
    // The key as it is encoded in the URL, plus its encoded comma.
    const size = encodeURIComponent(key).length + 3;
    if (chars + size > LOOKUP_URL_KEY_CHARS && batches[batches.length - 1].length > 0) {
      batches.push([]);
      chars = 0;
    }
    batches[batches.length - 1].push(key);
    chars += size;
  }

  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("places_v2_lookup")
        .select("normalized_key, place_id, places_v2(*)")
        .in("normalized_key", batch)
    )
  );

  const hits = new Map<string, CachedPlace>();
  for (const { data, error } of results) {
    // A failed lookup leaves its keys to the miss path, as it always did.
    if (error || !data) continue;
    for (const row of data) {
      // `places_v2` is a 1:1 join → supabase-js returns the related row as an
      // object (or array depending on version). Normalize both shapes.
      const cached = Array.isArray(row.places_v2) ? row.places_v2[0] : row.places_v2;
      if (cached) hits.set(row.normalized_key, cached);
    }
  }

  if (hits.size > 0 && countHits) {
    // Visibility: a free cache hit (0 Places spend). Logged so the cost
    // dashboard can compute a real activity-image cache-hit rate.
    void logApiCalls(
      Array.from(hits.keys(), () => ({
        apiName: "google_places_search",
        endpoint: "places:searchText (activity, cache hit)",
        status: 200,
        responseTimeMs: 0,
        cacheHit: true,
        costUsd: 0,
      }))
    );
    // hit_count + last_accessed_at on both tables, for cache-warmth analytics.
    // then() is what sends it: a query builder that is never awaited is never
    // sent. Until the function's migration is applied the call fails with
    // PGRST202 and the hits go uncounted.
    void supabase.rpc("record_places_v2_hits", { p_keys: Array.from(hits.keys()) }).then(
      ({ error }) => {
        if (error && error.code !== "PGRST202") {
          console.warn("[places_v2] hit counts not recorded:", error.message);
        }
      },
      () => {}
    );
  }

  return hits;
}

/**
 * place_id-keyed cache lookup + populate.
 *
 * Two tables:
 *   - `places_v2_lookup` — many normalized name keys → one place_id (the cheap
 *     row to check on every request)
 *   - `places_v2` — one row per Google place_id (full data; the row we want)
 *
 * Cache HIT path: the row comes from the one joined SELECT lookupCachedPlaces
 * makes for every key of the trip. No Places spend unless the photo ref is
 * stale (step 1b).
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
  photoRefreshBudget: { remaining: number },
  cachedPlaces: Promise<Map<string, CachedPlace>>
): Promise<PlaceRecord | null> {
  const supabase = createAdminClient();

  // ---------- 1. Cache HIT path ----------
  // This key's row from the trip's one lookup, which logged and counted it.
  const cached = (await cachedPlaces).get(normalizedKey);
  if (cached) {
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

  // ---------- 2. Cache MISS path: resolve the place_id first ----------
  // A name Google already found nothing for is not searched again, and
  // doesn't spend the budget.
  if (paidBudget.remaining > 0 && (await isKnownNoMatch(normalizedKey))) {
    return null;
  }
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
  let partial: PlaceRecord | null | undefined = null;
  let failed = false;
  for (const query of destination ? [`${name} ${destination}`, name] : [name]) {
    partial = await searchPlaceId(query, name);
    if (partial) break;
    if (partial === undefined) failed = true;
  }
  if (!partial) {
    // Google answered and found nothing: remember it for the next save.
    if (!failed) await recordNoMatch(normalizedKey);
    return null;
  }

  // ---------- 2b. place_id dedup ----------
  // Name variants ("Colosseum" / "Il Colosseo" / "The Roman Colosseum") share
  // one place_id, but the lookup above only matches identical normalized
  // names. With the place_id from Text Search, check places_v2 directly: if
  // it already has a photo, skip the Place Details call and just record the
  // new lookup.
  const { data: existingRow, error: existingError } = await supabase
    .from("places_v2")
    .select("*")
    .eq("place_id", partial.place_id)
    .maybeSingle();
  if (existingError) throw existingError;

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
    const found = await fetchNewPlace(partial.place_id);
    if (found?.photo) {
      partial.photo_resource_name = found.photo.photo_resource_name;
      partial.photo_url = found.photo.photo_url;
    }
    // A row without a point takes Google's name and point for the place: what
    // tells it from another (isAnotherPlace). A row cached with them keeps its own.
    const base = (existingRow as PlaceRecord | null) ?? partial;
    place = {
      ...base,
      ...(base.latitude == null && found?.point ? { display_name: found.display_name ?? base.display_name, ...found.point } : {}),
      photo_resource_name: partial.photo_resource_name,
      photo_url: partial.photo_url,
    };
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
 * Names Google found no place for, kept as the legacy fallback's "no photo"
 * rows (`place_search`/`activity_image`): that fallback then answers from the
 * row instead of repeating the same searches.
 */
const noMatchKey = (normalizedKey: string) => generateCacheKey("place_search", `activity_img:${normalizedKey}`);

async function isKnownNoMatch(normalizedKey: string): Promise<boolean> {
  const row = await getFromDatabase<CachedActivityImage>(noMatchKey(normalizedKey), "activity_image");
  return row !== null && !row.imageUrl;
}

async function recordNoMatch(normalizedKey: string): Promise<void> {
  await saveToDatabase<CachedActivityImage>(noMatchKey(normalizedKey), "activity_image", { imageUrl: null }, NO_MATCH_DAYS);
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
  photoRefreshBudget: { remaining: number },
  cachedPlaces: Promise<Map<string, CachedPlace>>,
  point?: { lat?: number; lng?: number }
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
    const place = await getOrFetchPlace(name, destination || "", normalizedKey, paidBudget, photoRefreshBudget, cachedPlaces);
    if (place?.photo_url) {
      // Google's place may be another one than the activity names: then no
      // paid photo, and no legacy lookup either, which finds the same place.
      if (isAnotherPlace(name, point, place)) {
        void logApiCall({
          apiName: "google_places_search",
          endpoint: "places:searchText (activity, another place)",
          status: 200,
          responseTimeMs: 0,
          cacheHit: true,
          costUsd: 0,
        });
        return null;
      }
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
  coordinates?: { lat: number; lng: number };
}

const isPoint = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);

/**
 * Whether Google's place for an activity is another place: named otherwise and
 * over 2 km from the activity (a trattoria's dinner found as the Colosseum), or
 * over 1,000 km away whatever its name (a namesake on another continent).
 * Nearer, a different name is often the same place in another language, and a
 * different point often the model's own. Names in two scripts can't be told
 * apart, and one name spaced two ways ("L'Uni Vert", "L'UniVert") is the same;
 * without Google's name and point, or with the placeholder point of an activity
 * the model gave none, it can't tell either, and says no.
 */
export function isAnotherPlace(
  name: string,
  point: { lat?: number; lng?: number } | undefined,
  place: { display_name?: string | null; latitude?: number | string | null; longitude?: number | string | null }
): boolean {
  const lat = place.latitude == null ? NaN : Number(place.latitude);
  const lng = place.longitude == null ? NaN : Number(place.longitude);
  if (!point || !isPoint(point.lat, point.lng) || isPlaceholderPoint(point.lat, point.lng as number) || !isPoint(lat, lng)) return false;
  const km = distanceM(point.lat, point.lng as number, lat, lng) / 1000;
  if (km > 1000) return true;
  const google = place.display_name ? placeName(place.display_name) : "";
  if (!google || hasLatin(google) !== hasLatin(name) || spelledWithin(google, name)) return false;
  return km > 2 && !namesAgree(name, google);
}

const letters = (s: string) => s.normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const hasLatin = (s: string) => /[a-z]/i.test(s.normalize("NFD"));
/** A name found in another once spaces and marks are gone: "Taotaoju" in "Dinner at Tao Tao Ju". */
const spelledWithin = (part: string, whole: string) => letters(part).length >= 5 && letters(whole).includes(letters(part));

/**
 * Wikimedia photos for the activities that are places, by normalized key. A
 * place Google found earlier lends its name and coordinates; otherwise the
 * activity's own. Without `wait` (a plan being generated), new lookups run
 * after the response, for the planner to pick up.
 */
async function landmarkPhotosFor(
  groups: Map<string, { activity: ActivityWithImage; name: string; type: string }[]>,
  cachedPlaces: Promise<Map<string, CachedPlace>>,
  wait: boolean
): Promise<Map<string, string>> {
  if (!LANDMARK_PHOTOS || groups.size === 0) return new Map();
  try {
    const places = await cachedPlaces.catch(() => new Map<string, CachedPlace>());
    const lookups: LandmarkLookup[] = [];
    for (const [key, [first]] of groups) {
      if (NOT_A_PLACE_TYPES.has(first.type)) continue;
      // Google's place lends its name and point only when it is this place:
      // a "Dinner at Felice a Testaccio" that Google found as the Colosseum
      // would get the Colosseum's photo.
      const found = places.get(key);
      const googleName = found?.display_name ? placeName(found.display_name) : undefined;
      const place = googleName && namesAgree(first.name, googleName) ? found : undefined;
      const [lat, lng] = isPoint(place?.latitude, place?.longitude)
        ? [place?.latitude, place?.longitude]
        : [first.activity.coordinates?.lat, first.activity.coordinates?.lng];
      const names = [place && googleName, first.name].filter((n): n is string => !!n);
      const meal = MEAL_TYPES.has(normalizeActivityType(first.type, first.name));
      // Without a point, only a photo already found for this name can come back.
      lookups.push(isPoint(lat, lng) ? { key, names, lat, lng: lng as number, meal } : { key, names, meal });
    }
    return await landmarkPhotos(lookups, {
      waitMs: wait ? LANDMARK_WAIT_MS : 0,
      maxNew: wait ? MAX_NEW_LANDMARKS : MAX_NEW_LANDMARKS_IN_BACKGROUND,
    });
  } catch (err) {
    console.warn("[Activity Images] Wikimedia photos unavailable:", err instanceof Error ? err.message : err);
    return new Map();
  }
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
  opts: { maxPaidLookups?: number; reresolveCurated?: boolean; freePhotosOnly?: boolean } = {}
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
  // The planner's preview of a plan nobody has kept yet: Wikimedia photos and
  // stock images only. A Google photo, even a cached one, is a paid download
  // each time it is shown; kept trips get theirs when opened.
  const freePhotosOnly = opts.freePhotosOnly ?? false;

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
    /^(\/api\/places\/photo\?name=places%2F[A-Za-z0-9_-]+%2Fphotos%2F|\/api\/places\/photo\?name=places\/[A-Za-z0-9_-]+\/photos\/|\/api\/images\/wikimedia\/|https:\/\/images\.pexels\.com\/|https:\/\/images\.unsplash\.com\/)/;
  // Save-time mode: a real place photo (Google proxy or Wikimedia) is final
  // (keep it, never re-pay), but a curated Pexels/Unsplash fallback is NOT
  // final — re-resolve it so a kept trip upgrades from stock to a real photo.
  const PROXY_ONLY_URL_RE =
    /^(\/api\/places\/photo\?name=places%2F[A-Za-z0-9_-]+%2Fphotos%2F|\/api\/places\/photo\?name=places\/[A-Za-z0-9_-]+\/photos\/|\/api\/images\/wikimedia\/)/;
  // Preview mode: only a Wikimedia photo is final. A stock image is looked up
  // again (a free photo may exist by now), and so is a Google one, never used.
  const WIKIMEDIA_URL_RE = /^\/api\/images\/wikimedia\//;
  const knownGoodRe = freePhotosOnly ? WIKIMEDIA_URL_RE : reresolveCurated ? PROXY_ONLY_URL_RE : KNOWN_GOOD_URL_RE;

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

  // One cache lookup for every key (see lookupCachedPlaces). Each key awaits
  // it and handles a failure itself; the catch only marks it handled.
  const cachedPlaces =
    RESOLVE_ACTIVITY_PHOTOS && groups.size > 0
      ? lookupCachedPlaces(Array.from(groups.keys()), !freePhotosOnly)
      : Promise.resolve(new Map<string, CachedPlace>());
  cachedPlaces.catch(() => {});

  // Wikimedia first: a place with a free photo makes no Google call and no
  // Google download. Generation (no paid budget) never waits for new lookups.
  const landmarks = await landmarkPhotosFor(groups, cachedPlaces, maxPaidLookups > 0);

  await Promise.all(
    Array.from(groups.entries()).map(async ([normalizedKey, occurrences]) => {
      const first = occurrences[0];
      let url: string | null = landmarks.get(normalizedKey) ?? null;
      try {
        if (!freePhotosOnly) url ??= await resolveActivityImage(first.name, destination || "", normalizedKey, paidBudget, photoRefreshBudget, cachedPlaces, first.activity.coordinates);
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
    `(${placesHits} places, ${landmarks.size} of them Wikimedia, ${fallbackHits} fallback) in ${duration}ms`
  );

  return days;
}
