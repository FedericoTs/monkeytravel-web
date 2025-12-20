/**
 * Unified Cache Manager
 *
 * Consolidates all caching patterns across the app:
 * - Memory cache (in-memory Map with TTL, LRU eviction)
 * - Database cache (Supabase for persistent storage)
 * - Request deduplication (coalesces in-flight requests)
 *
 * Benefits:
 * - Single source of truth for TTL configuration
 * - Consistent key generation using MD5
 * - Unified statistics tracking
 * - Supports both memory-only and database-backed caching
 * - Automatic LRU eviction when memory limit is reached
 *
 * @example
 * // Simple memory cache
 * const result = await cache.withMemory('flights', params, fetchFlights);
 *
 * // Database-backed cache with memory layer
 * const result = await cache.withDatabase('place_details', placeId, {
 *   cacheDays: 180,
 *   fetcher: () => fetchPlaceDetails(placeId),
 * });
 */

import crypto from "crypto";
import { supabase } from "@/lib/supabase";

// ============================================================================
// Types
// ============================================================================

export type CacheType =
  // Memory-only caches (volatile, fast)
  | "flights"
  | "flight_price"
  | "hotels"
  | "hotel_offer"
  | "hotel_list"
  | "locations"
  | "autocomplete"
  // Database-backed caches (persistent, slower)
  | "place_details"
  | "place_search"
  | "geocoding"
  | "distance"
  | "weather";

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  expiresAt: number;
  hits: number;
  size?: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  deduped: number;
}

interface DatabaseCacheOptions<T> {
  /** Days until expiration */
  cacheDays: number;
  /** Fetcher function if cache miss */
  fetcher: () => Promise<T>;
  /** Cache type for Supabase */
  cacheType?: string;
  /** Whether to use memory layer as well */
  useMemoryLayer?: boolean;
}

// ============================================================================
// TTL Configuration (centralized)
// ============================================================================

/**
 * TTL values in milliseconds
 * Organized by volatility - shorter TTLs for frequently changing data
 */
export const CACHE_TTL: Record<CacheType, number> = {
  // Highly volatile (minutes)
  flight_price: 3 * 60 * 1000,        // 3 minutes
  hotel_offer: 10 * 60 * 1000,        // 10 minutes
  flights: 10 * 60 * 1000,            // 10 minutes
  autocomplete: 30 * 60 * 1000,       // 30 minutes

  // Moderately stable (hours)
  hotels: 2 * 60 * 60 * 1000,         // 2 hours
  weather: 3 * 60 * 60 * 1000,        // 3 hours

  // Very stable (days) - these also use database caching
  locations: 24 * 60 * 60 * 1000,     // 24 hours
  hotel_list: 24 * 60 * 60 * 1000,    // 24 hours
  place_search: 30 * 24 * 60 * 60 * 1000,   // 30 days
  geocoding: 90 * 24 * 60 * 60 * 1000,      // 90 days
  distance: 60 * 24 * 60 * 60 * 1000,       // 60 days
  place_details: 180 * 24 * 60 * 60 * 1000, // 180 days
};

/**
 * TTL in days for database caching
 */
export const CACHE_TTL_DAYS: Partial<Record<CacheType, number>> = {
  place_details: 180,
  geocoding: 90,
  distance: 60,
  place_search: 30,
  weather: 1,
};

// ============================================================================
// Memory Cache
// ============================================================================

const MAX_MEMORY_ENTRIES = 1000;
const memoryCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

let stats: CacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0,
  deduped: 0,
};

/**
 * Generate a consistent MD5 cache key
 */
export function generateCacheKey(
  type: string,
  params: string | Record<string, unknown>
): string {
  const input = typeof params === "string"
    ? `${type}:${params}`
    : `${type}:${JSON.stringify(sortObjectKeys(params))}`;

  return crypto.createHash("md5").update(input).digest("hex");
}

/**
 * Sort object keys for consistent hashing
 */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null)
    .sort()
    .reduce((sorted, key) => {
      const value = obj[key];
      if (Array.isArray(value)) {
        sorted[key] = [...value].sort();
      } else if (typeof value === "object" && value !== null) {
        sorted[key] = sortObjectKeys(value as Record<string, unknown>);
      } else {
        sorted[key] = value;
      }
      return sorted;
    }, {} as Record<string, unknown>);
}

/**
 * LRU eviction when memory limit is reached
 */
function evictLRU(): void {
  if (memoryCache.size < MAX_MEMORY_ENTRIES) return;

  // Find oldest entry by timestamp
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of memoryCache.entries()) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    memoryCache.delete(oldestKey);
    stats.evictions++;
  }
}

/**
 * Get from memory cache
 */
export function getFromMemory<T>(key: string): T | null {
  const entry = memoryCache.get(key);

  if (!entry) {
    stats.misses++;
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    stats.misses++;
    stats.evictions++;
    return null;
  }

  entry.hits++;
  entry.timestamp = Date.now(); // Update for LRU
  stats.hits++;
  return entry.data as T;
}

/**
 * Set in memory cache
 */
export function setInMemory<T>(key: string, data: T, type: CacheType): void {
  evictLRU();

  const ttl = CACHE_TTL[type];
  const now = Date.now();

  memoryCache.set(key, {
    data,
    timestamp: now,
    expiresAt: now + ttl,
    hits: 0,
  });

  stats.sets++;
}

/**
 * Wrapper for memory-only caching with deduplication
 */
export async function withMemory<T>(
  type: CacheType,
  params: string | Record<string, unknown>,
  fetcher: () => Promise<T>
): Promise<{ data: T; cached: boolean; deduped: boolean }> {
  const cacheKey = generateCacheKey(type, params);

  // Check memory cache first
  const cached = getFromMemory<T>(cacheKey);
  if (cached !== null) {
    return { data: cached, cached: true, deduped: false };
  }

  // Check for in-flight request (deduplication)
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    stats.deduped++;
    return { data: await inflight as T, cached: false, deduped: true };
  }

  // Execute and track
  const promise = fetcher()
    .then((data) => {
      setInMemory(cacheKey, data, type);
      return data;
    })
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, promise);
  const data = await promise;

  return { data, cached: false, deduped: false };
}

// ============================================================================
// Database Cache (Supabase)
// ============================================================================

/**
 * Get from Supabase cache
 */
export async function getFromDatabase<T>(
  cacheKey: string,
  cacheType: string
): Promise<T | null> {
  try {
    const { data, error } = await supabase
      .from("google_places_cache")
      .select("*")
      .eq("place_id", cacheKey)
      .eq("cache_type", cacheType)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Update hit count asynchronously (fire and forget)
    supabase
      .from("google_places_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .then(() => {});

    stats.hits++;
    return data.data as T;
  } catch {
    return null;
  }
}

/**
 * Save to Supabase cache
 */
export async function saveToDatabase<T>(
  cacheKey: string,
  cacheType: string,
  data: T,
  cacheDays: number
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + cacheDays * 24 * 60 * 60 * 1000);

    const { error } = await supabase.from("google_places_cache").upsert(
      {
        place_id: cacheKey,
        cache_type: cacheType,
        data,
        request_hash: cacheKey,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );

    if (error) {
      console.error(`[Cache] Database save error (${cacheType}):`, error.message);
    } else {
      stats.sets++;
    }
  } catch (error) {
    console.error(`[Cache] Database save exception:`, error);
  }
}

/**
 * Wrapper for database-backed caching with optional memory layer
 */
export async function withDatabase<T>(
  type: CacheType,
  identifier: string | Record<string, unknown>,
  options: DatabaseCacheOptions<T>
): Promise<{ data: T; cached: boolean; source: "memory" | "database" | "api" }> {
  const { cacheDays, fetcher, cacheType = type, useMemoryLayer = true } = options;
  const cacheKey = generateCacheKey(type, identifier);

  // Check memory layer first (if enabled)
  if (useMemoryLayer) {
    const memoryCached = getFromMemory<T>(cacheKey);
    if (memoryCached !== null) {
      return { data: memoryCached, cached: true, source: "memory" };
    }
  }

  // Check for in-flight request (deduplication)
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    stats.deduped++;
    const data = await inflight as T;
    return { data, cached: false, source: "api" };
  }

  // Check database cache
  const dbCached = await getFromDatabase<T>(cacheKey, cacheType);
  if (dbCached !== null) {
    // Populate memory layer for fast subsequent access
    if (useMemoryLayer) {
      setInMemory(cacheKey, dbCached, type);
    }
    return { data: dbCached, cached: true, source: "database" };
  }

  // Execute fetcher with deduplication
  const promise = fetcher()
    .then(async (data) => {
      // Save to database
      await saveToDatabase(cacheKey, cacheType, data, cacheDays);
      // Save to memory layer
      if (useMemoryLayer) {
        setInMemory(cacheKey, data, type);
      }
      return data;
    })
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, promise);
  const data = await promise;

  return { data, cached: false, source: "api" };
}

// ============================================================================
// Statistics & Utilities
// ============================================================================

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats & {
  memorySize: number;
  inflightCount: number;
  hitRate: string;
} {
  const total = stats.hits + stats.misses;
  const hitRate = total > 0 ? ((stats.hits / total) * 100).toFixed(1) : "0.0";

  return {
    ...stats,
    memorySize: memoryCache.size,
    inflightCount: inflightRequests.size,
    hitRate: `${hitRate}%`,
  };
}

/**
 * Reset statistics
 */
export function resetStats(): void {
  stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
    deduped: 0,
  };
}

/**
 * Clear all memory cache
 */
export function clearMemoryCache(): void {
  const size = memoryCache.size;
  memoryCache.clear();
  stats.evictions += size;
}

/**
 * Invalidate entries matching a pattern
 */
export function invalidatePattern(pattern: string): number {
  let count = 0;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(pattern) || key.includes(pattern)) {
      memoryCache.delete(key);
      count++;
      stats.evictions++;
    }
  }
  return count;
}

/**
 * Cleanup expired entries
 */
export function cleanupExpired(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.expiresAt) {
      memoryCache.delete(key);
      cleaned++;
      stats.evictions++;
    }
  }

  return cleaned;
}

// Periodic cleanup every minute (production only)
if (typeof setInterval !== "undefined" && process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const cleaned = cleanupExpired();
    if (cleaned > 0 && process.env.NODE_ENV === "development") {
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }, 60 * 1000);
}

// ============================================================================
// Export default cache instance
// ============================================================================

export const cache = {
  // Core operations
  withMemory,
  withDatabase,
  generateKey: generateCacheKey,

  // Memory operations
  getFromMemory,
  setInMemory,
  clearMemory: clearMemoryCache,

  // Database operations
  getFromDatabase,
  saveToDatabase,

  // Utilities
  getStats: getCacheStats,
  resetStats,
  invalidatePattern,
  cleanupExpired,

  // Constants
  TTL: CACHE_TTL,
  TTL_DAYS: CACHE_TTL_DAYS,
};

export default cache;
