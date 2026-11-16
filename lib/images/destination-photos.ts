import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { logApiCall } from "@/lib/api-gateway";
import { buildDestinationPhotos, isNear, type DestinationPhotos, type NearPoint } from "@/lib/images/wikimedia";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";
import { logWriteError } from "@/lib/supabase/log-write-error";
import { logReadError } from "@/lib/supabase/log-read-error";

/**
 * A destination's Wikimedia photos, from the shared cache or found and stored
 * once (lib/images/wikimedia.ts). Null sends the caller to its own source.
 * New lookups are capped per hour: each stores files, and a destination is
 * whatever a visitor types.
 */

const buildLimiter = createRateLimiter("wikimedia-destination-photos", 30, 60 * 60_000);
const CACHE_TYPE = "wikimedia_destination";
const FOUND_DAYS = 365;
const NONE_DAYS = 30;
const BUILD_TIMEOUT_MS = 9000;

function cacheKey(destination: string): string {
  const normalized = destination.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("md5").update(`wikimedia_v1:${normalized}`).digest("hex");
}

function asPhotos(data: unknown): DestinationPhotos | null {
  const d = data as Partial<DestinationPhotos> | null;
  if (typeof d?.cover !== "string") return null;
  const at = typeof d.at?.lat === "number" && typeof d.at?.lng === "number" ? { at: { lat: d.at.lat, lng: d.at.lng } } : {};
  return { cover: d.cover, gallery: Array.isArray(d.gallery) ? d.gallery : [], ...at };
}

/** A trip's place from a query value "lat,lng,km" (lib/trips/persistTrip.ts), or undefined. */
export function readNear(value: string | null | undefined): NearPoint | undefined {
  const parts = (value ?? "").split(",");
  if (parts.length !== 3) return undefined;
  const [lat, lng, km] = parts.map(Number);
  if (![lat, lng, km].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || km < 0 || km > 20_000) return undefined;
  return { lat, lng, km };
}

// waitUntil keeps the insert alive after the response: a bare promise was cut
// off when the function froze, and the slow first lookups went unlogged.
function log(startedAt: number, cacheHit: boolean, error?: string) {
  waitUntil(logApiCall({
    apiName: "wikimedia",
    endpoint: "destination photos",
    status: error ? 500 : 200,
    responseTimeMs: Date.now() - startedAt,
    cacheHit,
    costUsd: 0,
    exactCost: true,
    error,
  }));
}

/**
 * Asked for a trip (`near`: where its stops are), the photos must show a
 * place near it. A stored photo of another place of the same name gives the
 * trip none and stays stored; one stored before places were kept is looked up
 * again for the trip, and what that finds is stored.
 */
export async function destinationPhotos(destination: string, request: NextRequest, near?: NearPoint): Promise<DestinationPhotos | null> {
  const db = cacheAdminDb();
  if (!db || !destination.trim()) return null;
  const startedAt = Date.now();
  const key = cacheKey(destination);

  const { data: row } = logReadError("destination photos: cache", await db
    .from("google_places_cache")
    .select("data")
    .eq("place_id", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle());
  const stored = row ? asPhotos(row.data) : null;
  if (row && (!near || !stored || stored.at)) {
    log(startedAt, true);
    return stored && near && stored.at && !isNear(stored.at, near) ? null : stored;
  }

  if (!(await buildLimiter.check(request, "global")).allowed) return stored;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS);
  try {
    const photos = await buildDestinationPhotos(destination, controller.signal, near);
    // Nothing near this trip: the stored photo stays for everyone else.
    if (stored && !photos) return null;
    const now = Date.now();
    logWriteError("destination-photos: cache", await db.from("google_places_cache").upsert(
      {
        place_id: key,
        cache_type: CACHE_TYPE,
        data: photos ?? { none: true },
        request_hash: key,
        cached_at: new Date(now).toISOString(),
        expires_at: new Date(now + (photos ? FOUND_DAYS : NONE_DAYS) * 86_400_000).toISOString(),
        hit_count: 0,
        last_accessed_at: new Date(now).toISOString(),
      },
      { onConflict: "place_id" },
    ));
    log(startedAt, false);
    return photos;
  } catch (err) {
    // Not cached: a timeout or an outage is tried again on the next request.
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[destination photos] Wikimedia lookup failed:", message);
    log(startedAt, false, message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
