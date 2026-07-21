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
import { logApiCall } from "@/lib/api-gateway";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// 365 days — Places metadata for popular tourist sites is effectively immutable.
//
// **2026-07-21 correction.** This constant used to be justified with "photo
// reference names from the new Places API are stable, so a stale ref still
// works." That is FALSE, and it was the root cause of a silent, months-long
// image regression: Google expires photo resource names, so a ref cached for
// up to a year is frequently dead by the time it is served. Measured on
// 2026-07-21: all 4,920 cached refs predated Google's current token
// generation, and refs for places whose photos Google still serves happily
// were 4xx-ing. /api/places/photo masked it by redirecting to a curated
// Pexels photo, so the cards looked fine and nobody noticed.
//
// The TTL stays at 365 days ON PURPOSE — the non-photo fields (id, name,
// location, address) really are stable, and shortening it would multiply the
// paid Places calls this cache exists to avoid. The photo ref is now
// self-healed at render time instead: /api/places/photo re-resolves from the
// place_id embedded in the dead ref and refreshes this row. See that route.
const ACTIVITY_IMAGE_CACHE_DAYS = 365;

// Per-trip cap on PAID Google Places resolutions (cost control, 2026-06-24).
// Each "resolution" is one fresh cache-MISS activity and may issue 1-3 billed
// Google calls (Text Search +/- a name-only retry, then Place Details Pro), so
// this bounds — but is not exactly equal to — the billed-call count per trip.
// Google Places was ~97% of API spend and scaled ~1:1 with trip size at
// ~$0.10/trip — unbounded growth with signups. Cache HITS stay free +
// unlimited (real photos); only fresh cache-MISS resolutions consume this budget.
// Once a trip exhausts it, remaining fresh activities get a curated fallback
// image (zero Google cost) instead of a real place photo. Tune this knob:
// lower = cheaper but more stock photos, higher = more real photos but pricier.
const MAX_PAID_PLACE_LOOKUPS_PER_TRIP = 4;

// Save-time enrichment budget (2026-06-30 cost pass). Trip GENERATION now runs
// with ZERO paid lookups — every activity gets a free cache-hit real photo or a
// type-relevant curated fallback at $0 Google cost (see the generate routes).
// Real Google photos are resolved ONCE, later, when a trip is actually SAVED
// (the small fraction of generations that convert), via the fire-and-forget
// /api/trips/[id]/enrich-photos endpoint. Saves are rare, so we can afford a
// more generous budget here than at generation — kept trips end up with MORE
// real photos than the old eager path, not fewer — while bounced generations
// (the overwhelming majority) now cost nothing.
export const SAVE_TIME_PAID_LOOKUPS = 8;

// Google expires photo resource names after ~29 days. MEASURED 2026-07-21:
// 164 live probes, zero misclassifications, with an hour-resolution boundary
// between 2026-06-22 21:09Z (dead) and 23:43Z (alive) — a ~693h lifetime.
//
// 21 days leaves a ~8-day safety margin under that. Refreshing sooner would
// spend Places quota on refs that still work; later risks handing a brand-new
// trip a ref that is already dead.
const PHOTO_REF_MAX_AGE_DAYS = 21;

// Cache rows are kept for a YEAR (ACTIVITY_IMAGE_CACHE_DAYS) because the
// non-photo fields really are stable, so a cache hit routinely carries a photo
// ref far past 21 days. Refreshing every stale ref we touch would put an
// unbounded number of paid Google calls on the trip-generation critical path —
// which already has a timeout history (task #353) — so each trip may refresh
// at most this many. Anything beyond the cap keeps its stale ref and is
// repaired lazily by /api/places/photo's self-heal on first view.
//
// 2 is deliberately small: the point is to stop the cache rotting, not to
// repair it in one pass. Every generation heals a little, and the heal path
// covers whatever this misses at zero generation-time cost.
const PHOTO_REFRESH_PER_TRIP = 2;

// COST KILL-SWITCH (2026-07-02). Per api_request_logs, ACTIVITY place/photo
// resolution is the #1 Google Places line: Place Details Pro ($0.017, ~$23.5/30d)
// + Text Search Essentials ($0.005, ~$9.3/30d) per fresh place, both at ~0% cache
// hit. Crucially, the real Google COORDS this resolves are never applied to the
// itinerary (activities keep the synthetic coords baked at generation) — the ONLY
// used output is the thumbnail photo. Generated (unsaved) trips already run
// `maxPaidLookups:0` → curated-by-type thumbnails, which users convert from just
// fine. So default this OFF: activity thumbnails use the curated fallback and make
// ZERO paid Places calls. The destination HERO cover (a separate cache in
// /api/places) stays a real photo. Flip PLACES_ACTIVITY_PHOTOS_ENABLED=true in the
// Vercel env to restore real activity photos — no redeploy needed.
const RESOLVE_ACTIVITY_PHOTOS =
  process.env.PLACES_ACTIVITY_PHOTOS_ENABLED === "true";

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

  // ---------- Text Search Essentials ($5/1K) ----------
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
    httpStatus = searchResponse.status;

    if (!searchResponse.ok) {
      return null;
    }

    const data = await searchResponse.json();
    place = data.places?.[0] ?? null;
  } catch {
    return null;
  } finally {
    // Every call here is a paid Essentials miss — the cache hit short-circuits
    // upstream in getOrFetchPlace before we ever reach this function. Fire-and-
    // forget so logging never adds latency to the generation path (the request
    // stays alive through Gemini, so the insert lands). Previously these calls
    // were a raw fetch with no gateway wrapper — invisible to the cost dashboard.
    void logApiCall({
      apiName: "google_places_search",
      endpoint: "places:searchText (activity)",
      status: httpStatus || 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: 0.005,
    });
  }

  if (!place?.id) {
    return null;
  }

  // Partial record — place_id + metadata, no photo yet (Step 2 / cache fills it).
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
 * Step 2 — Place Details Pro ($17/1K). Given a known place_id, fetch its photos
 * and build the proxy photo URL. Split out from the search so callers that
 * already have the place cached (by place_id, incl. trip-backfilled rows) can
 * SKIP this paid call entirely — the core of the place_id dedup.
 */
export async function fetchPlacePhoto(
  placeId: string
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
          "X-Goog-FieldMask": "photos",
        },
      }
    );
    httpStatus = detailsResponse.status;

    if (!detailsResponse.ok) {
      return null;
    }

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

    if (!photoResourceName) {
      return null;
    }

    // **2026-05-24 live-test fix (revision 2):** raw
    // `places.googleapis.com/v1/.../media?key=...` AND resolved
    // `lh3.googleusercontent.com/place-photos/...` URLs both 504 from
    // direct browser loads. Our `/api/places/photo` proxy fetches them
    // server-side and streams back with CDN-friendly cache headers.
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
      endpoint: "places/{id}:photos (activity)",
      status: httpStatus || 500,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd: 0.017,
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

      // ---------- 1b. Photo-ref freshness (2026-07-21) ----------
      // The rest of this row stays valid for a year, but the photo ref dies at
      // ~29 days (see PHOTO_REF_MAX_AGE_DAYS). Without this check a cache hit
      // happily hands a brand-new trip a ref that expired weeks ago — which is
      // how 82% of stored activity photos ended up dead.
      //
      // NOTE this makes a *small number* of cache hits paid, which the comment
      // on the budget gate below ("cache HITS are free + unlimited") no longer
      // covers unconditionally. It is capped per trip and never touches the
      // resolution budget, so it cannot starve genuinely-new activities.
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

  // ---------- 2. Cache MISS path — resolve place_id cheaply first ----------
  // Per-trip paid-call budget gate. Cache HITS above are free + unlimited;
  // only fresh (cache-miss) lookups are paid, so we cap how many a single trip
  // makes. Once exhausted, return null → the caller serves a curated fallback
  // (zero Google cost). We check-then-decrement synchronously (no await between
  // the two), so even under Promise.all the budget is consumed atomically and
  // exactly N activities ever reach the paid path.
  if (paidBudget.remaining <= 0) {
    return null;
  }
  paidBudget.remaining--;

  // Text Search Essentials ($5/1K) gives us the canonical place_id. Query
  // order: `${name} ${destination}` first (matches local landmarks better),
  // then name-only fallback.
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
  // Many activity-name variants ("Colosseum" / "Il Colosseo" / "The Roman
  // Colosseum") collapse to one Google place_id. The normalized-name lookup
  // above only catches IDENTICAL normalized names; a fresh variant misses it
  // even when the place is already cached. Now that Text Search has revealed
  // the canonical place_id, check places_v2 directly: if it's already cached
  // WITH a photo (incl. rows backfilled from historical trips), skip the
  // $17/1K Place Details Pro call entirely and just record the new lookup.
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
  // Widen every per-type pool with the generic scenic sets. With photo
  // resolution OFF (cost kill-switch) the 1-2 images per type made curated
  // fallbacks blatantly repetitive within a single trip (replay 019f24bf:
  // "images are stock and very repetitive"). Union with the attraction +
  // fallback pools → ~4-6 already-vetted URLs per type, zero new assets.
  const own = CURATED_BY_TYPE[type.toLowerCase()] ?? [];
  const widened = [
    ...own,
    ...(CURATED_BY_TYPE["attraction"] ?? []),
    ...FALLBACK_IMAGES,
  ].filter((url, i, arr) => arr.indexOf(url) === i);
  return widened[index % widened.length] ?? FALLBACK_IMAGES[0];
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
  normalizedKey: string,
  paidBudget: { remaining: number },
  photoRefreshBudget: { remaining: number }
): Promise<string | null> {
  // Cost kill-switch (2026-07-02): when activity photos are disabled, resolve to
  // the curated-by-type fallback (the caller applies it when this returns null)
  // and make ZERO paid Places calls. All paid activity paths — the place_id cache
  // MISS and the legacy fallback below — flow through here, so this single guard
  // fully stops activity Places spend. Already-enriched trips are unaffected:
  // their activities already carry a good image_url and never reach this resolver.
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
 *   2. Skip any that already have a KNOWN-GOOD `image_url`.
 *   3. Group by normalized key — same key → same Places lookup.
 *   4. Resolve each UNIQUE key exactly once in parallel.
 *   5. Fan the resolved URL back out to every activity that shared that key.
 *
 * "Known-good" guard (2026-06-06): Gemini sometimes hallucinates raw Google
 * URLs (`places.googleapis.com/v1/...`, `maps.googleapis.com/maps/api/place/photo`)
 * into its structured output. Those URLs lack auth headers and 404/403 from
 * the browser, leaking through to broken-image icons. Production audit found
 * 249 broken activity image URLs across 23 trips — half the corpus.
 *
 * Fix: only trust `image_url` if it's our `/api/places/photo` proxy URL or a
 * curated Pexels/Unsplash URL. Anything else (raw Google, expired, foreign)
 * is treated as missing — we strip it and re-resolve through the resolver
 * pipeline, which produces a guaranteed-good proxy URL or a curated fallback.
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
  // We track each occurrence by its (day, index) so we can write the URL
  // back to the exact reference later.
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
  // Separate from paidBudget on purpose: a photo-ref refresh must never eat
  // the budget that resolves genuinely-new activities.
  const photoRefreshBudget = { remaining: PHOTO_REFRESH_PER_TRIP };
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
