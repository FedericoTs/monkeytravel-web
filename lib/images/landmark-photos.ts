import { createHash } from "crypto";
import { waitUntil } from "@vercel/functions";
import { logApiCall } from "@/lib/api-gateway";
import { buildLandmarkPhoto, type LandmarkQuery } from "@/lib/images/wikimedia-landmark";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";

/**
 * Activities' Wikimedia photos (lib/images/wikimedia-landmark.ts), from the
 * shared cache or found and stored once. Keyed by the activity's normalized
 * name and destination, like places_v2_lookup.
 */

const CACHE_TYPE = "wikimedia_landmark";
const FOUND_DAYS = 365;
const NONE_DAYS = 60;
const BUILD_TIMEOUT_MS = 8000;
// Two lookups at a time: Wikidata answers 429 to more from one client.
const CONCURRENCY = 2;

export interface LandmarkLookup extends Omit<LandmarkQuery, "lat" | "lng"> {
  /** normalizeActivityKey(name, destination) */
  key: string;
  /** Without a point, the activity can only be answered from the cache. */
  lat?: number;
  lng?: number;
}

const canLookUp = (l: LandmarkLookup): l is LandmarkLookup & LandmarkQuery => typeof l.lat === "number" && typeof l.lng === "number";

const cacheKey = (key: string) => createHash("md5").update(`wikimedia_landmark_v1:${key}`).digest("hex");

/** The cached answer per activity key: its photo URL, or null when the place has none. Unknown keys are absent. */
export async function cachedLandmarkPhotos(keys: string[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  const db = cacheAdminDb();
  if (!db || !keys.length) return found;
  const byHash = new Map(keys.map((k) => [cacheKey(k), k]));
  const { data, error } = await db
    .from("google_places_cache")
    .select("place_id, data")
    .in("place_id", [...byHash.keys()])
    .gt("expires_at", new Date().toISOString());
  if (error) return found;
  for (const row of data ?? []) {
    const key = byHash.get(row.place_id as string);
    const url = (row.data as { url?: unknown } | null)?.url;
    if (key) found.set(key, typeof url === "string" ? url : null);
  }
  return found;
}

async function buildOne(lookup: LandmarkLookup & LandmarkQuery): Promise<string | null> {
  const db = cacheAdminDb();
  if (!db) return null;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS);
  try {
    const url = await buildLandmarkPhoto(db, lookup, controller.signal);
    const now = Date.now();
    const hash = cacheKey(lookup.key);
    await db.from("google_places_cache").upsert(
      {
        place_id: hash,
        cache_type: CACHE_TYPE,
        data: url ? { url } : { none: true },
        request_hash: hash,
        cached_at: new Date(now).toISOString(),
        expires_at: new Date(now + (url ? FOUND_DAYS : NONE_DAYS) * 86_400_000).toISOString(),
        hit_count: 0,
        last_accessed_at: new Date(now).toISOString(),
      },
      { onConflict: "place_id" },
    );
    waitUntil(logApiCall({ apiName: "wikimedia", endpoint: "landmark photo", status: 200, responseTimeMs: now - startedAt, cacheHit: false, costUsd: 0, exactCost: true }));
    return url;
  } catch (err) {
    // Not cached: a timeout or an outage is tried again next time.
    const message = err instanceof Error ? err.message : String(err);
    waitUntil(
      logApiCall({ apiName: "wikimedia", endpoint: "landmark photo", status: 500, responseTimeMs: Date.now() - startedAt, cacheHit: false, costUsd: 0, exactCost: true, error: message }),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Finds and stores photos for these activities, two at a time; the ones found are added to `found` as they come. */
export async function buildLandmarkPhotos(lookups: (LandmarkLookup & LandmarkQuery)[], found = new Map<string, string>()): Promise<Map<string, string>> {
  let next = 0;
  const worker = async () => {
    while (next < lookups.length) {
      const lookup = lookups[next++];
      const url = await buildOne(lookup);
      if (url) found.set(lookup.key, url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lookups.length) }, worker));
  return found;
}

/**
 * Photos for these activities: cached ones, plus the new lookups that finish
 * within `waitMs`. The rest finish after the response, for the next plan or
 * save to find cached; a plan being generated waits for none (0).
 */
export async function landmarkPhotos(lookups: LandmarkLookup[], opts: { waitMs: number; maxNew: number }): Promise<Map<string, string>> {
  const cached = await cachedLandmarkPhotos(lookups.map((l) => l.key));
  const photos = new Map<string, string>();
  for (const [key, url] of cached) if (url) photos.set(key, url);
  const fresh = lookups.filter((l) => !cached.has(l.key)).filter(canLookUp).slice(0, opts.maxNew);
  if (!fresh.length) return photos;
  const found = new Map<string, string>();
  const building = buildLandmarkPhotos(fresh, found);
  waitUntil(building);
  if (opts.waitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([building, new Promise((resolve) => (timer = setTimeout(resolve, opts.waitMs)))]);
    clearTimeout(timer);
  }
  for (const [key, url] of found) photos.set(key, url);
  return photos;
}
