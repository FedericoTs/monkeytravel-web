import { haversineKm } from "@/lib/map/geo";
import { isRealPoint } from "./placeholder-point";

/**
 * Farther than this from every other stop of its day, a stop's pin isn't where
 * the stop is: a same-name place elsewhere, or coordinates written wrong. A day
 * trip stays nearer, and a ride's far end loses nothing by having no pin.
 */
export const FAR_PIN_KM = 300;

/**
 * The stops of a day (by index) whose pin is farther than FAR_PIN_KM from every
 * other pinned stop of it. Judged only against at least two stops that stay: a
 * day split in two places, each with stops, keeps every pin, and so does one
 * with too few pins to tell which is out of place.
 */
export function farPins(points: ReadonlyArray<{ lat?: number | null; lng?: number | null } | null | undefined>): Set<number> {
  const pinned: Array<{ i: number; at: { lat: number; lng: number } }> = [];
  points.forEach((point, i) => {
    if (isRealPoint(point)) pinned.push({ i, at: { lat: point.lat, lng: point.lng } });
  });
  const far = new Set<number>();
  for (const a of pinned) {
    if (pinned.every((b) => b === a || haversineKm(a.at, b.at) > FAR_PIN_KM)) far.add(a.i);
  }
  // A stop that stays has another near it, so when any stays, two do.
  return far.size < pinned.length ? far : new Set();
}
