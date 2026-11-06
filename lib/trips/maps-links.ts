import type { Activity } from "@/types";

/**
 * Links that open Google. These need no key and cost nothing. A place is found
 * by its name and address, and a day opens as directions through its stops.
 */

type Place = Pick<Activity, "name"> & Partial<Pick<Activity, "address" | "location">>;
type Stop = Place & Partial<Pick<Activity, "type" | "transport_mode">>;

const MAPS = "https://www.google.com/maps";
// What a directions link may carry.
const MAX_WAYPOINTS = 9;
const MAX_URL_LENGTH = 2048;

const placeQuery = ({ name, address, location }: Place) =>
  encodeURIComponent([name, address || location].filter(Boolean).join(" "));

export function placeMapsUrl(place: Place): string {
  return `${MAPS}/search/?api=1&query=${placeQuery(place)}`;
}

export function placeSearchUrl(place: Place): string {
  return `https://www.google.com/search?q=${placeQuery(place)}`;
}

/**
 * How directions name a stop. One stop Google can't find stops the whole route,
 * and a name it doesn't know does that even with a good address, so an address
 * with a number in it goes alone.
 */
const stopQuery = ({ name, address, location }: Place) =>
  encodeURIComponent(address && /\d/.test(address) ? address : [name, address || location].filter(Boolean).join(", "));

/** A leg between cities is how the day gets somewhere, not somewhere to stop. */
const isStop = ({ type, transport_mode }: Stop) => !transport_mode && type !== "transport";

/**
 * Directions through the day's stops, in order, or null with fewer than two.
 * The middle stops past what a link can carry are left out; the day still ends
 * at its last stop.
 */
export function dayRouteMapsUrl(activities: readonly Stop[]): string | null {
  const stops = activities.filter(isStop);
  if (stops.length < 2) return null;
  const base = `${MAPS}/dir/?api=1&origin=${stopQuery(stops[0])}&destination=${stopQuery(stops[stops.length - 1])}`;
  const waypoints = stops.slice(1, -1).slice(0, MAX_WAYPOINTS).map(stopQuery);
  while (waypoints.length > 0) {
    const url = `${base}&waypoints=${waypoints.join("%7C")}`;
    if (url.length <= MAX_URL_LENGTH) return url;
    waypoints.pop();
  }
  return base;
}
