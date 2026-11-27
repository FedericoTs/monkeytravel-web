import "server-only";
import { daylightFor } from "@/lib/ai/daylight";
import { isRealPoint } from "@/lib/trip/placeholder-point";

/**
 * When the sun sets on a trip's first evening, where its first pinned stop is: "17:32", in the place's own time.
 * One of the story's clues, and true for the trip's own dates. Null when the trip has no date or no pin, or the
 * sun doesn't set there that day.
 */
export function firstSunset(trip: { start_date?: string | null; itinerary?: unknown }): string | null {
  const start = typeof trip.start_date === "string" ? trip.start_date.slice(0, 10) : "";
  if (!start || !Array.isArray(trip.itinerary)) return null;
  for (const day of trip.itinerary as Array<{ activities?: unknown } | null>) {
    for (const stop of Array.isArray(day?.activities) ? (day.activities as Array<{ coordinates?: unknown } | null>) : []) {
      const point = stop?.coordinates as { lat?: number | null; lng?: number | null } | null | undefined;
      if (isRealPoint(point)) return daylightFor({ lat: point.lat, lng: point.lng }, start, start)?.first.sunset ?? null;
    }
  }
  return null;
}
