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
import { cityPointsFor } from "./city-points";

type Point = { lat: number; lng: number };

/** What a name may not hold to be read as itself in an ILIKE: its pattern characters, PostgREST's `*` among them. */
const PATTERN = /[%_*\\]/;

/** The place's point, or null when neither the curated destinations nor the cities table has it. */
export async function placePointFor(name: string, db: SupabaseClient | null = cacheAdminDb()): Promise<Point | null> {
  const place = name.replace(/\s+/g, " ").trim();
  if (!place) return null;
  if (db && !PATTERN.test(place)) {
    try {
      // ILIKE with no wildcard is a case-insensitive equality; curated names are unique.
      const { data } = logReadError("place point", await db.from("destinations").select("latitude, longitude").ilike("name", place).limit(1));
      const row = (Array.isArray(data) ? data[0] : null) as { latitude?: unknown; longitude?: unknown } | null;
      if (row && typeof row.latitude === "number" && typeof row.longitude === "number") {
        return { lat: row.latitude, lng: row.longitude };
      }
    } catch {
      // The cities table answers instead.
    }
  }
  const [point] = await cityPointsFor([place], db);
  return point;
}
