/**
 * Where each city of a route is, from the cities table the destination search already reads (no paid lookup), so
 * each city is planned with its own sunrise and sunset (lib/ai/daylight.ts): a trip through several cities sends no
 * one place's coordinates, and its sunset stops sat hours from the sun.
 */
import "server-only";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";
import { haversineKm } from "@/lib/map/geo";
import { foldText } from "./destination-key";

/** A row of search_geo_cities (supabase/migrations: geo_cities). */
export interface CityCandidate {
  name: string;
  ascii_name: string | null;
  latitude: number;
  longitude: number;
  population: number | null;
}

type Point = { lat: number; lng: number };

/** A city further than this from the middle of the route is a namesake elsewhere in the world, not the one meant. */
const FARTHEST_KM = 3000;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const pointOf = (c: CityCandidate): Point => ({ lat: c.latitude, lng: c.longitude });

/**
 * Each city's point among the places found for it: only places of the city's own name ("Oban", not "Obando"), and
 * of those the one nearest the middle of the route ("Córdoba" in Spain on a trip through Spain). The middle is taken
 * from each city's first place of its name (the search puts the biggest first), the median of them, so one namesake
 * can't move it. Null for a city with no place of its name, or none within FARTHEST_KM of the middle.
 */
export function chooseCityPoints(found: CityCandidate[][], cities: string[]): Array<Point | null> {
  const named = found.map((candidates, i) => {
    const name = foldText(cities[i] ?? "");
    return candidates.filter((c) => foldText(c.name) === name || foldText(c.ascii_name ?? "") === name);
  });
  const anchors = named.flatMap((candidates) => candidates.slice(0, 1));
  if (anchors.length === 0) return cities.map(() => null);
  const middle = { lat: median(anchors.map((a) => a.latitude)), lng: median(anchors.map((a) => a.longitude)) };
  return named.map((candidates) => {
    const nearest = candidates.map(pointOf).sort((a, b) => haversineKm(a, middle) - haversineKm(b, middle))[0];
    return nearest && haversineKm(nearest, middle) <= FARTHEST_KM ? nearest : null;
  });
}

type Db = { rpc: (fn: string, args: { q: string; lim: number }) => PromiseLike<{ data: unknown; error: unknown }> };

/** The cities' points (chooseCityPoints). A city the lookup fails for, or every city without a database, is null. */
export async function cityPointsFor(cities: string[], db: Db | null = cacheAdminDb()): Promise<Array<Point | null>> {
  if (!db) return cities.map(() => null);
  const found = await Promise.all(
    cities.map(async (city) => {
      const q = foldText(city).replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
      if (q.length < 2) return [];
      try {
        const { data } = await db.rpc("search_geo_cities", { q, lim: 8 });
        return Array.isArray(data) ? (data as CityCandidate[]) : [];
      } catch {
        return [];
      }
    })
  );
  return chooseCityPoints(found, cities);
}
