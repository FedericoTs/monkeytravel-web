/**
 * Map geometry helpers (zero-API-cost)
 *
 * Used by TripMap to draw per-day polylines + walking-time labels
 * without any paid routing API (Google Directions, Mapbox, ORS).
 *
 * Trade-off: these are great-circle (straight-line) distances + flat
 * speed multipliers. They do not account for streets, elevation,
 * traffic, transit schedules, or one-way restrictions. Good enough
 * for at-a-glance planning; the UI MUST disclose this to the user.
 *
 * If/when revenue justifies a real routing API, swap this module's
 * implementation but keep the function signatures.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in kilometers using the Haversine formula.
 *
 * @example
 * haversineKm({lat: 48.8566, lng: 2.3522}, {lat: 48.8584, lng: 2.2945})
 * // ~4.2 km (Notre-Dame → Eiffel Tower, straight line)
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export type TravelMode = "walking" | "transit" | "driving";

/**
 * Rough travel-time estimate in minutes.
 *
 * Multipliers (per km of straight-line distance):
 *  - walking: 12 min/km (~5 km/h, comfortable city pace)
 *  - transit: 4 min/km  (~15 km/h, slow urban transit average incl. waiting)
 *  - driving: 2 min/km  (~30 km/h, urban driving with lights/parking)
 *
 * NOTE: rough estimate; doesn't account for actual streets, transit
 * schedules, or traffic — for visual planning only. We use straight-line
 * (haversine) input deliberately, so the multipliers absorb a typical
 * detour factor (real streets are ~1.3× straight-line for short urban hops).
 */
export function walkingMinutes(
  km: number,
  mode: TravelMode = "walking"
): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  const perKm = mode === "walking" ? 12 : mode === "transit" ? 4 : 2;
  return Math.max(1, Math.round(km * perKm));
}

/**
 * Format a duration in minutes as a short, locale-aware string.
 *  - 0    → "0 min"
 *  - 12   → "12 min"
 *  - 83   → "1 h 23 min"
 *  - 120  → "2 h"
 *
 * Locale is currently used to choose the unit label ("min" / "h").
 * We keep this simple to avoid pulling Intl.RelativeTimeFormat plurals
 * for a UI label that only ever needs two units.
 */
export function formatDuration(minutes: number, locale: string): string {
  const safe = Math.max(0, Math.round(minutes));
  const isIt = locale?.toLowerCase().startsWith("it");
  const isEs = locale?.toLowerCase().startsWith("es");
  const minLabel = isIt || isEs ? "min" : "min";
  const hourLabel = isIt ? "h" : isEs ? "h" : "h";

  if (safe < 60) {
    return `${safe} ${minLabel}`;
  }
  const hours = Math.floor(safe / 60);
  const rem = safe % 60;
  if (rem === 0) {
    return `${hours} ${hourLabel}`;
  }
  return `${hours} ${hourLabel} ${rem} ${minLabel}`;
}

/**
 * Midpoint of two coordinates (for placing the segment-duration badge).
 *
 * Simple average — for the city-scale distances we deal with on a single
 * day's itinerary, the difference vs. a real spherical midpoint is
 * imperceptible (sub-meter), so we keep the math cheap.
 */
export function midpoint(a: LatLng, b: LatLng): LatLng {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}
