import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItineraryDay } from "@/types";

/**
 * Read-time itinerary photo refresher.
 *
 * **The problem this fixes (2026-06-04):**
 * Activity `image_url` strings baked into `trips.itinerary` JSONB go stale.
 * In production: 17/76 trips had activities pointing at `/api/places/photo`
 * URLs whose `photo_resource_name` was truncated or had since been rotated
 * by Google, causing the proxy to forward a 400 from Google's `/media`
 * endpoint — broken-image icon on the activity card.
 *
 * The places_v2 table IS being kept current with the canonical resource
 * name for each place_id (writer path: lib/images/activity.ts). The bug
 * is that the bake-into-itinerary write happens ONCE at trip generation
 * time, then the URL is frozen — no read-side mechanism to catch drift.
 *
 * **The architectural fix:**
 * On every server-side trip read (TripDetailPage, SharedTripPage, the
 * /api/trips/[id] route, the template preview page), pass the itinerary
 * through this function. It:
 *
 *   1. Extracts the place_id from every activity's image_url that points
 *      at our `/api/places/photo?name=places/<place_id>/...` proxy.
 *   2. Batch-queries `places_v2` for the canonical photo_url per place_id
 *      (single SELECT, indexed lookup).
 *   3. Replaces stale image_urls with the canonical one. Leaves other
 *      image_urls (Pexels fallbacks, externally-supplied URLs) untouched.
 *
 * Non-proxy URLs (Pexels curated fallbacks, etc.) are left as-is — those
 * URLs are static and don't go stale.
 *
 * If places_v2 has no row for an extracted place_id (e.g. cache eviction)
 * the original URL is preserved — better to show the maybe-stale URL than
 * to blank the activity. Sentry could later be wired in to capture the
 * "miss" rate, but mute by default to avoid noise.
 *
 * Cost: 1 DB roundtrip per trip read (batched IN-clause across all
 * activities in the trip). Adds ~10-20ms server latency. Falls back to
 * the original itinerary silently on any DB error — read MUST NOT fail.
 */

/**
 * Parse the Google place_id out of any image URL shape we've ever produced
 * or seen Gemini hallucinate. Returns null if no place_id can be extracted.
 *
 * Three URL shapes handled:
 *   1. Our canonical proxy URL — `/api/places/photo?name=places/<id>/photos/<hash>`
 *   2. RAW Places v1 URL Gemini hallucinates —
 *      `https://places.googleapis.com/v1/places/<id>/photos/<hash>` (404s from
 *      the browser because the auth header is missing)
 *   3. NEW Places photo URL — `https://places.googleapis.com/.../media` (rare)
 *
 * The 4th shape we see in DB — `https://maps.googleapis.com/maps/api/place/photo`
 * (the deprecated Maps Photo API with `photo_reference=` query param) — does
 * NOT carry a place_id, so this returns null and the caller's URL stays as-is.
 * Those rows must be NULLed by the backfill instead.
 */
function extractPlaceIdFromAnyUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;

  // Shape 1: our proxy URL
  if (url.startsWith("/api/places/photo")) {
    try {
      const parsed = new URL(url, "https://monkeytravel.app");
      const name = parsed.searchParams.get("name");
      if (!name) return null;
      const match = name.match(/^places\/([^/]+)\/photos\//);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  // Shape 2 / 3: raw Places v1 URL (with or without `/media` suffix)
  const v1Match = url.match(/^https:\/\/places\.googleapis\.com\/v1\/places\/([^/]+)\/photos\//);
  if (v1Match) return v1Match[1];

  return null;
}

/**
 * Some URL shapes are structurally broken and unrecoverable — they carry a
 * `photo_reference` instead of a place_id, so we can't look them up in
 * places_v2. Best UX is to NULL them so the frontend renders a gradient
 * placeholder instead of Google's "permission denied" error PNG.
 */
function isUnrecoverableUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  // Deprecated Maps Photo API — 403s from the browser.
  if (url.startsWith("https://maps.googleapis.com/maps/api/place/photo")) return true;
  return false;
}

// Intentionally loose — we touch only `image_url` on activities and
// `activities` on days. The index signature is omitted so that the
// stricter ItineraryDay/Activity types from @/types satisfy this shape
// without requiring those types to inherit `[k: string]: unknown`.
interface ActivityLike {
  image_url?: string | null;
}

interface DayLike {
  activities?: ActivityLike[];
}

/**
 * Refresh stale activity photo URLs from the places_v2 cache.
 *
 * Returns a NEW array (does not mutate the input). Activities whose
 * image_url is not an /api/places/photo URL, or whose place_id is not
 * in places_v2, are returned unchanged.
 *
 * Generic over the day/activity shape so it works with both the canonical
 * ItineraryDay type and the looser server-side `(trip.itinerary as ...)`
 * cast used at the call sites.
 */
export async function refreshItineraryPhotos<T extends DayLike>(
  days: T[] | undefined | null
): Promise<T[]> {
  if (!Array.isArray(days) || days.length === 0) return days ?? [];

  // 1. Extract every distinct place_id referenced by an activity image_url —
  // whether it's our proxy URL or a raw Google URL that snuck through.
  const placeIds = new Set<string>();
  let hasUnrecoverable = false;
  for (const day of days) {
    if (!Array.isArray(day.activities)) continue;
    for (const activity of day.activities) {
      const id = extractPlaceIdFromAnyUrl(activity.image_url);
      if (id) placeIds.add(id);
      else if (isUnrecoverableUrl(activity.image_url)) hasUnrecoverable = true;
    }
  }
  // Nothing to do if every URL is already canonical and none are broken.
  if (placeIds.size === 0 && !hasUnrecoverable) return days;

  // 2. Batch-lookup canonical photo_urls. Single SELECT; places_v2 is
  // indexed on place_id (PK). Service-role client because places_v2 is
  // RLS-locked to service_role (cache infra, no user data).
  let canonical = new Map<string, string>();
  if (placeIds.size > 0) {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("places_v2")
        .select("place_id, photo_url")
        .in("place_id", Array.from(placeIds));
      if (!error && data) {
        canonical = new Map(
          data
            .filter((row): row is { place_id: string; photo_url: string } =>
              Boolean(row.place_id) && typeof row.photo_url === "string"
            )
            .map((row) => [row.place_id, row.photo_url])
        );
      }
    } catch {
      // DB failure must not break the trip render — fall through and apply
      // only the null-out path below (handles unrecoverable URLs even without
      // cache access).
    }
  }
  if (canonical.size === 0 && !hasUnrecoverable) return days;

  // 3. Rebuild the array with refreshed URLs.
  return days.map((day) => {
    if (!Array.isArray(day.activities)) return day;
    const activities = day.activities.map((activity) => {
      const url = activity.image_url;
      // Unrecoverable URL (deprecated Maps Photo API) → null it so the frontend
      // renders a gradient instead of Google's error PNG.
      if (isUnrecoverableUrl(url)) {
        return { ...activity, image_url: null };
      }
      const placeId = extractPlaceIdFromAnyUrl(url);
      if (!placeId) return activity;
      const fresh = canonical.get(placeId);
      if (!fresh || fresh === url) return activity;
      return { ...activity, image_url: fresh };
    });
    return { ...day, activities };
  });
}

/**
 * Convenience wrapper for the canonical ItineraryDay shape used by the
 * trip detail pages. Keeps the call sites short.
 *
 * The cast preserves the full ItineraryDay structure — refreshItineraryPhotos
 * only mutates `image_url` strings, so every other field flows through
 * unchanged. Cast is safe because the generic preserves the input type.
 */
export async function refreshTripItinerary(
  itinerary: ItineraryDay[] | undefined | null
): Promise<ItineraryDay[]> {
  const refreshed = await refreshItineraryPhotos(itinerary ?? []);
  return refreshed as unknown as ItineraryDay[];
}
