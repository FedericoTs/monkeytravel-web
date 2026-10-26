/**
 * "Saved in N trips" for an activity: matching it to the places that
 * public.compute_saved_places() counted. Each place is [name, lat, lng, trips],
 * where name is lower(unaccent(btrim(name))) and lat/lng the centre of that
 * name's cluster, so one name in two cities stays two places.
 */

export type SavedPlace = [name: string, lat: number, lng: number, trips: number];

export type SavedPlaceIndex = Map<string, Array<[lat: number, lng: number, trips: number]>>;

/** Characters unaccent() expands into letters rather than stripping marks. */
const LETTERS: Record<string, string> = {
  ß: "ss", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D", þ: "th", Þ: "TH", ı: "i",
};

/** The name key the database groups on: lower(unaccent(btrim(name))). */
export function placeKey(name: string): string {
  return name
    .replace(/^ +| +$/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ßæÆœŒøØłŁđĐþÞı]/g, (c) => LETTERS[c] ?? c)
    .toLowerCase();
}

export function buildSavedPlaceIndex(places: SavedPlace[]): SavedPlaceIndex {
  const index: SavedPlaceIndex = new Map();
  for (const [name, lat, lng, trips] of places) {
    const list = index.get(name);
    if (list) list.push([lat, lng, trips]);
    else index.set(name, [[lat, lng, trips]]);
  }
  return index;
}

/** Same reach as the clustering (eps 0.2°), measured from the cluster's centre. */
const MAX_KM = 25;

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)) * 111.32;
  const y = (lat2 - lat1) * 110.57;
  return Math.hypot(x, y);
}

/**
 * How many trips saved this place, or null when it is not among the counted
 * places. Without coordinates there is no telling same-named places apart, so
 * nothing is shown.
 */
export function savedTripsFor(
  index: SavedPlaceIndex,
  name: string | undefined,
  coordinates: { lat: number; lng: number } | undefined,
): number | null {
  if (!name || !coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) return null;
  const candidates = index.get(placeKey(name));
  if (!candidates) return null;
  let best: { km: number; trips: number } | null = null;
  for (const [lat, lng, trips] of candidates) {
    const km = distanceKm(coordinates.lat, coordinates.lng, lat, lng);
    if (km <= MAX_KM && (!best || km < best.km)) best = { km, trips };
  }
  return best?.trips ?? null;
}
