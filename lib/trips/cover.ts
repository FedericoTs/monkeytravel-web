import type { ItineraryDay } from "@/types";
import { WIKIMEDIA_IMAGE_PATH, wikimediaSheetSrc } from "@/lib/images/wikimedia-credit";

/** Activity types whose photo shows the place itself rather than a meal, a bed or a bus. */
const SIGHT_TYPES = new Set([
  "attraction", "landmark", "sightseeing", "cultural", "cultural_attraction",
  "museum", "nature", "park", "urban", "adventure",
]);

/** Never a cover: a station, an airport or a hotel says nothing about the trip. */
const NOT_A_COVER = new Set(["transport", "transportation", "travel", "accommodation"]);

/** Places photos stored on a cover are the hero's size; cards and phones get smaller ones from it. */
const COVER_WIDTH = 1920;
const COVER_HEIGHT = 1200;

function isPlacePhoto(url: string | undefined): url is string {
  return !!url && (url.startsWith("/api/places/photo?") || url.startsWith(WIKIMEDIA_IMAGE_PATH));
}

/** A place photo at the largest size there is: a Places photo at cover size, a Wikimedia one at its 960px copy. */
const asCover = (src: string) => (src.startsWith(WIKIMEDIA_IMAGE_PATH) ? wikimediaSheetSrc(src) : coverSizedPlacesSrc(src));

/** A Places photo proxy src at cover size, every other param kept. */
export function coverSizedPlacesSrc(src: string): string {
  const [path, query] = src.split("?");
  const params = new URLSearchParams(query);
  params.set("w", String(COVER_WIDTH));
  params.set("h", String(COVER_HEIGHT));
  return `${path}?${params.toString()}`;
}

/**
 * A cover from the trip's own photos: the first sight with a real place photo,
 * else the first real place photo that is not transport or lodging. Null when
 * the itinerary has only curated stand-ins, which never become a cover.
 */
export function pickCoverFromItinerary(days: ItineraryDay[] | null | undefined): string | null {
  let other: string | null = null;
  for (const day of days ?? []) {
    for (const activity of day.activities ?? []) {
      if (!isPlacePhoto(activity.image_url)) continue;
      const type = String(activity.type ?? "").toLowerCase();
      if (SIGHT_TYPES.has(type)) return asCover(activity.image_url);
      if (!other && !NOT_A_COVER.has(type)) other = activity.image_url;
    }
  }
  return other ? asCover(other) : null;
}
