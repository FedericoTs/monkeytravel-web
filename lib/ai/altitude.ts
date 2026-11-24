/**
 * Places high enough that a first day of sights leaves travellers ill (acute mountain sickness): a plan for Leh, at
 * 3,500 m, sent a couple up the palace, through a museum and up the stupa's steps from 08:30 on the day they flew
 * in, and one for Cusco planned four stops from 09:00. Every guide says to rest that day. Most arrive from far lower,
 * so the plan's first day there is told so, unless the route's city before it is high too.
 */
import type { TripCreationParams } from "@/types";

interface HighPlace {
  names: RegExp;
  place: string;
  metres: number;
}

const HIGH: HighPlace[] = [
  { names: /\bleh\b|\bladakh\b/i, place: "Leh", metres: 3500 },
  { names: /\bnubra\b/i, place: "Nubra Valley", metres: 3050 },
  { names: /\bpangong\b/i, place: "Pangong Tso", metres: 4250 },
  { names: /\bspiti\b|\bkaza\b/i, place: "Kaza", metres: 3800 },
  { names: /\blhasa\b|\btibet\b/i, place: "Lhasa", metres: 3650 },
  { names: /\bshangri-?la\b|\bzhongdian\b/i, place: "Shangri-La", metres: 3300 },
  { names: /\bcusco\b|\bcuzco\b|\bmachu picchu\b/i, place: "Cusco", metres: 3400 },
  { names: /\bpuno\b|\btiticaca\b/i, place: "Puno", metres: 3830 },
  // La Paz in Mexico is by the sea: only Bolivia's.
  { names: /\bla paz,?\s*bolivia\b|\bel alto\b/i, place: "La Paz", metres: 3640 },
  { names: /\buyuni\b/i, place: "Uyuni", metres: 3660 },
  { names: /(?<!san luis\s)\bpotos[ií](?!\p{L})/iu, place: "Potosí", metres: 4090 },
  { names: /\bquito\b/i, place: "Quito", metres: 2850 },
  { names: /\bnamche\b|\beverest base camp\b|\bkhumbu\b/i, place: "Namche Bazaar", metres: 3440 },
  { names: /\bhuaraz\b/i, place: "Huaraz", metres: 3050 },
  { names: /\btawang\b/i, place: "Tawang", metres: 3050 },
];

/** The high place a name is, if it is one. */
export function highPlace(name: string): { place: string; metres: number } | null {
  const found = HIGH.find((h) => h.names.test(name));
  return found ? { place: found.place, metres: found.metres } : null;
}

/**
 * The line for the plan's first day at a high place: rest, a short flat walk and an early dinner. None when the place
 * isn't high, or when the route reaches it from a city that is high too (they are used to the height by then).
 */
export function altitudeLine({ destination, destinations, startDate }: Pick<TripCreationParams, "destination" | "destinations" | "startDate">): string {
  const high = highPlace(destination);
  if (!high) return "";
  const cities = (destinations ?? []).map((d) => d.city.trim());
  const at = cities.findIndex((city) => city.toLowerCase() === destination.trim().toLowerCase());
  if (at > 0 && highPlace(cities[at - 1])) return "";
  const metres = high.metres.toLocaleString("en-US");
  return `Altitude: ${high.place} is about ${metres} m up, and most visitors arrive from far lower. The first day here (${startDate}) is for getting used to the height: rest, one short flat walk and an early, light dinner at most; no climbs, treks, high passes or long drives up. Keep the next day gentle too.`;
}
