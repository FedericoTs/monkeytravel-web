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
