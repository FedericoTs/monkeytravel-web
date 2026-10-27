import type { ItineraryDay } from "@/types";

/**
 * Whether any activity can be placed on the map. Trips saved from the old
 * ChatGPT app carry none, and the map would otherwise open on its default centre.
 */
export function hasCoordinates(days: ItineraryDay[]): boolean {
  return days.some((day) => day.activities.some((a) => Boolean(a.coordinates?.lat && a.coordinates?.lng)));
}
