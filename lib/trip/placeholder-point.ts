/**
 * Where validateAndFixCoordinates puts an activity the model gave no usable
 * coordinates, when it doesn't know the destination: near the centre of
 * Europe, spread a little so map pins don't stack. Such a point says nothing
 * about where the activity is.
 */
export const PLACEHOLDER_POINT = { lat: 48.0, lng: 10.0 };

/** Whether a point is that placeholder: its spread stays inside 0.1° on any real day. */
export function isPlaceholderPoint(lat: number, lng: number): boolean {
  return Math.abs(lat - PLACEHOLDER_POINT.lat) < 0.1 && Math.abs(lng - PLACEHOLDER_POINT.lng) < 0.1;
}

/**
 * Whether an activity's coordinates say where it is, so a map can pin it and a
 * route can measure to it: a point on the globe, not 0,0 and not the placeholder.
 */
export function isRealPoint<T extends { lat?: number | null; lng?: number | null }>(
  point: T | null | undefined
): point is T & { lat: number; lng: number } {
  const lat = point?.lat;
  const lng = point?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if ((lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !isPlaceholderPoint(lat, lng);
}
