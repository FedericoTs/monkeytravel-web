/**
 * Where a stop the assistant adds is, from the coordinates the model gives it.
 * They're kept only when they are a real point within reach of the trip, so a
 * map can pin the stop and a journey to it can be measured. Otherwise the stop
 * has none, and the coordinate fallback (lib/trip/coordinate-fallback.ts)
 * places it.
 */

import { haversineKm } from "@/lib/map/geo";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import type { ItineraryDay } from "@/types";

type Point = { lat: number; lng: number };

/** How far from the trip's known places a new stop may be: a long day trip, or the next city. */
const MAX_KM_FROM_TRIP = 500;

/** The trip's stops that have a real location. */
export function knownPoints(days: ItineraryDay[]): Point[] {
  const out: Point[] = [];
  for (const d of days) {
    for (const a of d.activities ?? []) {
      const c = a?.coordinates;
      if (isRealPoint(c)) out.push({ lat: c.lat, lng: c.lng });
    }
  }
  return out;
}

/**
 * The model's coordinates for a stop, to 6 decimals, when they are a real point
 * within reach of one of the trip's known places, or any real point when the
 * trip knows none. Undefined otherwise.
 */
export function stopLocation(raw: unknown, known: Point[]): Point | undefined {
  const c = (raw ?? {}) as { lat?: unknown; lng?: unknown };
  const point = { lat: Number(c.lat), lng: Number(c.lng) };
  if (!isRealPoint(point)) return undefined;
  if (known.length > 0 && !known.some((k) => haversineKm(k, point) <= MAX_KM_FROM_TRIP)) return undefined;
  return { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 };
}
