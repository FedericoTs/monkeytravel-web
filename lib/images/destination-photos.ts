import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { logApiCall } from "@/lib/api-gateway";
import { buildDestinationPhotos, type DestinationPhotos } from "@/lib/images/wikimedia";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";

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
  return typeof d?.cover === "string" ? { cover: d.cover, gallery: Array.isArray(d.gallery) ? d.gallery : [] } : null;
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

export async function destinationPhotos(destination: string, request: NextRequest): Promise<DestinationPhotos | null> {
  const db = cacheAdminDb();
  if (!db || !destination.trim()) return null;
  const startedAt = Date.now();
  const key = cacheKey(destination);

  const { data: row } = await db
    .from("google_places_cache")
    .select("data")
    .eq("place_id", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (row) {
    log(startedAt, true);
    return asPhotos(row.data);
  }

  if (!(await buildLimiter.check(request, "global")).allowed) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS);
  try {
    const photos = await buildDestinationPhotos(db, destination, controller.signal);
    const now = Date.now();
    await db.from("google_places_cache").upsert(
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
    );
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
