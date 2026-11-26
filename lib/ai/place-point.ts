/**
 * Where a place typed by its bare name is: the curated destination of that
 * name first, as the destination search ranks it, then the cities table
 * (./city-points.ts). The table's biggest "Bali" is a town in India and its
 * "Goa" a town in the Philippines; the curated ones are the island and the
 * Indian state travellers mean.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";
import { logReadError } from "@/lib/supabase/log-read-error";
import { cityPointsFor, type CityPoint } from "./city-points";

/** What a name may not hold to be read as itself in an ILIKE: its pattern characters, PostgREST's `*` among them. */
const PATTERN = /[%_*\\]/;

const cleaned = (name: string) => name.replace(/\s+/g, " ").trim();

/** The curated destination of that name's point, or null: none, no location, a failed read or no database. */
export async function curatedPointFor(name: string, db: SupabaseClient | null = cacheAdminDb()): Promise<CityPoint | null> {
  const place = cleaned(name);
  if (!place || !db || PATTERN.test(place)) return null;
  try {
    // ILIKE with no wildcard is a case-insensitive equality; curated names are unique.
    const { data } = logReadError("place point", await db.from("destinations").select("latitude, longitude, country").ilike("name", place).limit(1));
    const row = (Array.isArray(data) ? data[0] : null) as { latitude?: unknown; longitude?: unknown; country?: unknown } | null;
    if (row && typeof row.latitude === "number" && typeof row.longitude === "number") {
      return { lat: row.latitude, lng: row.longitude, ...(typeof row.country === "string" && row.country ? { country: row.country } : {}) };
    }
  } catch {
    // The cities table answers instead.
  }
  return null;
}

/** The place's point, or null when neither the curated destinations nor the cities table has it. */
export async function placePointFor(name: string, db: SupabaseClient | null = cacheAdminDb()): Promise<CityPoint | null> {
  const place = cleaned(name);
  if (!place) return null;
  const curated = await curatedPointFor(place, db);
  if (curated) return curated;
  const [point] = await cityPointsFor([place], db);
  return point;
}
