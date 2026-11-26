/**
 * A city of a route planned at the mirror image of where it is. The model now and then writes a city's longitudes
 * without their minus (or its latitudes without theirs, or both): a town in the Americas lands in Asia. The card from
 * the city before is then a day-long flight that takes the arrival day, its sights go to late at night on the city's
 * other days, and the trip closes with a flight back. A long trip written in parts (lib/ai/plan-in-parts.ts) can get
 * one part so: its days then sit on the far side of the world from the rest.
 *
 * The route shows it: such a city is thousands of kilometres from every other city of the route, and its stops with
 * the sign turned land beside one of them. Pure.
 */
import type { GeneratedItinerary } from "@/types";
import { haversineKm } from "@/lib/map/geo";
import { isRealPoint } from "@/lib/trip/placeholder-point";

type Point = { lat: number; lng: number };

/** A city this far from every other city of its route is either far away or mirrored. */
const APART_KM = 3000;
/** A mirrored city's stops, turned, land at most this far from another city of the route. */
const BESIDE_KM = 800;

/** A point with the sign of its longitude turned, or of its latitude, or of both. */
const MIRRORS: Array<(p: Point) => Point> = [
  (p) => ({ lat: p.lat, lng: -p.lng }),
  (p) => ({ lat: -p.lat, lng: p.lng }),
  (p) => ({ lat: -p.lat, lng: -p.lng }),
];

/** The middle of a city's stops, as many north of it as south and east as west. Null with no real pin. */
function middleOf(result: GeneratedItinerary): Point | null {
  const points = (result.days ?? []).flatMap((d) => d.activities ?? []).map((a) => a.coordinates).filter((c) => isRealPoint(c)) as Point[];
  if (points.length === 0) return null;
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { lat: mid(points.map((p) => p.lat)), lng: mid(points.map((p) => p.lng)) };
}

/** Whether one plan's stops sit APART_KM or more from every other plan's: it may be the turned one. */
export function apartFromTheRest(results: GeneratedItinerary[]): boolean {
  const middles = results.map(middleOf);
  return middles.some((middle, i) => {
    const others = middles.filter((m, j): m is Point => j !== i && m !== null);
    return !!middle && others.length > 0 && others.every((m) => haversineKm(middle, m) >= APART_KM);
  });
}

/** Whether `point` lies beside one of the plans' stops: only then can it say which of two is the turned one. */
export function besideOneOf(results: GeneratedItinerary[], point: Point): boolean {
  return results.some((result) => {
    const middle = middleOf(result);
    return !!middle && haversineKm(middle, point) <= BESIDE_KM;
  });
}

/** The city's plan with each stop on the far side turned back beside `middle`; a stop already there stays. */
function turnedBack(result: GeneratedItinerary, mirror: (p: Point) => Point, middle: Point): GeneratedItinerary {
  return {
    ...result,
    days: (result.days ?? []).map((d) => ({
      ...d,
      activities: (d.activities ?? []).map((a) => {
        const at = a.coordinates;
        if (!isRealPoint(at)) return a;
        const turned = mirror(at);
        return haversineKm(turned, middle) < haversineKm(at, middle) ? { ...a, coordinates: { ...at, ...turned } } : a;
      }),
    })),
  };
}

/**
 * The route's cities with each mirrored one turned back, and which were. A city is turned when it is APART_KM from
 * every other city and turned lands within BESIDE_KM of one: when the cities table puts it nearer the turned side
 * (`points`, as cityPointsFor gives them), or, with no point to say, when it is the only city that could be turned.
 * Of two cities mirrored to each other, a point that says one is where its stops are tells that the other is turned;
 * with no point for either, both stay.
 */
export function unmirroredCities(results: GeneratedItinerary[], points: Array<Point | null>): { results: GeneratedItinerary[]; turned: number[] } {
  const middles = results.map(middleOf);
  const candidates = middles.flatMap((middle, i) => {
    if (!middle) return [];
    const others = middles.filter((m, j): m is Point => j !== i && m !== null);
    if (others.some((m) => haversineKm(middle, m) < APART_KM)) return [];
    const mirror = MIRRORS.find((turn) => others.some((m) => haversineKm(turn(middle), m) <= BESIDE_KM));
    return mirror ? [{ i, middle, mirror }] : [];
  });
  const confirmed = candidates.filter(({ i, middle, mirror }) => {
    const point = points[i];
    return !!point && haversineKm(mirror(middle), point) < haversineKm(middle, point);
  });
  const unknown = candidates.filter(({ i }) => !points[i]);
  const turning = confirmed.length > 0 ? confirmed : unknown.length === 1 ? unknown : [];
  const out = [...results];
  for (const { i, middle, mirror } of turning) out[i] = turnedBack(results[i], mirror, mirror(middle));
  return { results: out, turned: turning.map(({ i }) => i) };
}
