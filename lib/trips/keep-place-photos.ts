import type { ItineraryDay } from "@/types";

/**
 * Whole-itinerary saves must not put fallback images back over real place
 * photos (20260924125000).
 *
 * Save-time enrichment swaps curated fallbacks for real place photos a few
 * seconds after a trip is created. A trip page that loaded before that still
 * holds the fallbacks, and its next save writes its whole copy. Photo-only
 * writes do not move itinerary_version (on purpose: a photo must never make
 * someone's edit a conflict), so the version check cannot catch it and every
 * photo silently went back to the fallback.
 *
 * Kept only for the SAME activity (same id and same name: a replaced activity
 * keeps its id but is a different place) and only when the incoming image is
 * not a place photo itself. Deliberate photo changes use the separate
 * activityPhoto path.
 */

/** Real place photos are served through our proxy; anything else is a fallback. */
export function isPlacePhoto(url: unknown): url is string {
  return typeof url === "string" && url.includes("/api/places/photo");
}

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

export function keepStoredPlacePhotos(incoming: ItineraryDay[], stored: unknown): { itinerary: ItineraryDay[]; kept: number } {
  if (!Array.isArray(stored)) return { itinerary: incoming, kept: 0 };

  const storedById = new Map<string, Loose>();
  for (const day of stored) {
    if (!isObject(day) || !Array.isArray(day.activities)) continue;
    for (const activity of day.activities) {
      if (isObject(activity) && typeof activity.id === "string" && activity.id && isPlacePhoto(activity.image_url)) {
        storedById.set(activity.id, activity);
      }
    }
  }
  if (storedById.size === 0) return { itinerary: incoming, kept: 0 };

  let kept = 0;
  const itinerary = incoming.map((day) => {
    if (!isObject(day) || !Array.isArray((day as Loose).activities)) return day;
    return {
      ...day,
      activities: day.activities.map((activity) => {
        if (!isObject(activity)) return activity;
        const a = activity as Loose;
        if (typeof a.id !== "string" || isPlacePhoto(a.image_url)) return activity;
        const s = storedById.get(a.id);
        if (!s || s.name !== a.name) return activity;
        kept += 1;
        return { ...activity, image_url: s.image_url as string };
      }),
    };
  });
  return { itinerary, kept };
}
