import { haversineKm } from "@/lib/map/geo";
import { isRealPoint } from "./placeholder-point";

/**
 * Farther than this from every other stop of its day, a stop's pin isn't where
 * the stop is: a same-name place elsewhere, or coordinates written wrong. A day
 * trip stays nearer.
 */
export const FAR_PIN_KM = 300;

type Stop = {
  coordinates?: { lat?: number | null; lng?: number | null } | null;
  type?: string | null;
  transport_mode?: string | null;
};

const RIDE_TYPES = new Set(["transport", "transportation", "travel", "transfer"]);

/** A ride: the card between two cities, or a stop the plan calls transport (a train, a flight, docking). */
export function isRide(stop: Stop): boolean {
  return Boolean(stop.transport_mode) || RIDE_TYPES.has((stop.type ?? "").toLowerCase());
}

/**
 * The stops of a day (by index) whose pin is farther than FAR_PIN_KM from every
 * other pinned stop of it. Judged only against at least two stops that stay: a
 * day split in two places, each with stops, keeps every pin, and so does one
 * with too few pins to tell which is out of place. A day with a ride keeps every
 * pin too: it is in two places, and the far one can be the ride's other end, or
 * the evening after it.
 */
export function farPins(stops: ReadonlyArray<Stop>): Set<number> {
  if (stops.some(isRide)) return new Set();
  const pinned: Array<{ i: number; at: { lat: number; lng: number } }> = [];
  stops.forEach((stop, i) => {
    const point = stop.coordinates;
    if (isRealPoint(point)) pinned.push({ i, at: { lat: point.lat, lng: point.lng } });
  });
  const far = new Set<number>();
  for (const a of pinned) {
    if (pinned.every((b) => b === a || haversineKm(a.at, b.at) > FAR_PIN_KM)) far.add(a.i);
  }
  // A stop that stays has another near it, so when any stays, two do.
  return far.size < pinned.length ? far : new Set();
}
