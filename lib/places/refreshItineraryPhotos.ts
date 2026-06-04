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
 * Parse `places/<place_id>/photos/<hash>` out of an /api/places/photo URL.
 * Returns null if the URL is not our proxy or doesn't match the expected
 * shape. URL-decoded because the proxy URL stores the resource name as
 * a query param with `%2F` etc.
 */
function extractPlaceIdFromProxyUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("/api/places/photo")) return null;
  try {
    // The proxy URL is relative; URL() needs a base.
    const parsed = new URL(url, "https://monkeytravel.app");
    const name = parsed.searchParams.get("name");
    if (!name) return null;
    // name looks like `places/<place_id>/photos/<hash>`
    const match = name.match(/^places\/([^/]+)\/photos\//);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
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

  // 1. Extract every distinct place_id referenced by an activity image_url.
  const placeIds = new Set<string>();
  for (const day of days) {
    if (!Array.isArray(day.activities)) continue;
    for (const activity of day.activities) {
      const id = extractPlaceIdFromProxyUrl(activity.image_url);
      if (id) placeIds.add(id);
    }
  }
  if (placeIds.size === 0) return days;

  // 2. Batch-lookup canonical photo_urls. Single SELECT; places_v2 is
  // indexed on place_id (PK). Service-role client because places_v2 is
  // RLS-locked to service_role (cache infra, no user data).
  let canonical: Map<string, string>;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("places_v2")
      .select("place_id, photo_url")
      .in("place_id", Array.from(placeIds));
    if (error || !data) {
      // DB failure must not break the trip render — return as-is.
      return days;
    }
    canonical = new Map(
      data
        .filter((row): row is { place_id: string; photo_url: string } =>
          Boolean(row.place_id) && typeof row.photo_url === "string"
        )
        .map((row) => [row.place_id, row.photo_url])
    );
  } catch {
    return days;
  }
  if (canonical.size === 0) return days;

  // 3. Rebuild the array with refreshed URLs.
  return days.map((day) => {
    if (!Array.isArray(day.activities)) return day;
    const activities = day.activities.map((activity) => {
      const placeId = extractPlaceIdFromProxyUrl(activity.image_url);
      if (!placeId) return activity;
      const fresh = canonical.get(placeId);
      if (!fresh || fresh === activity.image_url) return activity;
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
