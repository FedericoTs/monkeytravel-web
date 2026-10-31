import type { ItineraryDay } from "@/types";
import { isRealPoint } from "@/lib/trip/placeholder-point";

/**
 * Whether any activity can be placed on the map. Trips saved from the old
 * ChatGPT app carry none, and the map would otherwise open on its default centre.
 */
export function hasCoordinates(days: ItineraryDay[]): boolean {
  return days.some((day) => day.activities.some((a) => isRealPoint(a.coordinates)));
}
