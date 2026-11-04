import { isSameDestination } from "@/lib/trips/sameDestination";
import { DESTINATION_ALLOWLIST, DESTINATION_MAX_LENGTH, DESTINATION_MIN_LENGTH } from "@/lib/trips/request-limits";

/**
 * Another place for the whole trip, offered by the wizard's assistant when the
 * traveller asks for one ("give me Málaga", "I don't want to visit Mysore").
 * The page plans the place picked anew, for the same dates, rather than the
 * assistant rewriting the days under the old place's name: the title, the
 * photos and the checks all follow the destination. Client-safe.
 */
export interface TripPlace {
  name: string;
  country: string;
}

/** Places one reply offers, at most. */
export const MAX_ELSEWHERE = 3;

/** How a place reads in the destination field: "Málaga, Spain". */
export function placeLabel(p: TripPlace): string {
  return p.country ? `${p.name}, ${p.country}` : p.name;
}

/**
 * The places a reply offers that the planner can take: names the destination
 * field would accept, none of them the trip's own place (`current`), each once.
 */
export function readElsewhere(raw: unknown, current: string): TripPlace[] {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const places: TripPlace[] = [];
  for (const item of raw) {
    if (places.length === MAX_ELSEWHERE) break;
    if (!item || typeof item !== "object") continue;
    const place = { name: text((item as { name?: unknown }).name), country: text((item as { country?: unknown }).country) };
    const label = placeLabel(place);
    if (place.name.length < DESTINATION_MIN_LENGTH || label.length > DESTINATION_MAX_LENGTH || !DESTINATION_ALLOWLIST.test(label)) {
      continue;
    }
    if (isSameDestination(place.name, current) || places.some((p) => isSameDestination(p.name, place.name))) continue;
    places.push(place);
  }
  return places;
}
