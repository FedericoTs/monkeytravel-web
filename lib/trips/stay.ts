import { calculateHaversineDistance } from "@/lib/math/distance";
import type { TripStay } from "@/types";

/**
 * Where the traveller is staying, in their words: a hotel, an address or an
 * area. It goes into the plan's prompt as one line, so it is kept to one line,
 * without control characters, and short.
 */
export const STAY_NAME_MAX = 120;

/** The stay as one clean line, or "" when nothing is left of it. */
export function cleanStayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STAY_NAME_MAX)
    .trim();
}

/** Further than this from the destination, a stay belongs to another trip. */
export const STAY_FAR_KM = 60;

/**
 * Whether a picked stay is too far from the destination now chosen to be part
 * of this trip. A typed stay has no place, so it never is.
 */
export function stayFarFrom(stay: TripStay | null, destination: { latitude: number; longitude: number } | null): boolean {
  if (!stay?.coordinates || !destination) return false;
  return calculateHaversineDistance(stay.coordinates, { lat: destination.latitude, lng: destination.longitude }) > STAY_FAR_KM;
}

/**
 * A stay read back from a draft, a kept plan or the session tray, or null when
 * there isn't a usable one. Coordinates are kept only when both are real numbers.
 */
export function readStay(value: unknown): TripStay | null {
  if (!value || typeof value !== "object") return null;
  const { name, coordinates } = value as { name?: unknown; coordinates?: { lat?: unknown; lng?: unknown } };
  const clean = cleanStayName(name);
  if (!clean) return null;
  const { lat, lng } = coordinates ?? {};
  const placed =
    typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return { name: clean, ...(placed ? { coordinates: { lat, lng } } : {}) };
}
