/**
 * Caching Layer for Amadeus API Responses
 *
 * Implements a multi-tier caching strategy to minimize API calls:
 * - Memory cache for immediate reuse
 * - Configurable TTL per resource type
 * - Automatic cache invalidation
 *
 * Flight prices are volatile (5 min TTL), while locations rarely change (24h TTL).
 */

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  expiresAt: number;
  hits: number;
}

// Cache TTLs in milliseconds
// Optimized: Increased TTLs for user session patterns (users rarely refetch same route)
export const CACHE_TTL = {
  locations: 24 * 60 * 60 * 1000,     // 24 hours - IATA codes rarely change
  hotelList: 24 * 60 * 60 * 1000,    // 24 hours - hotel lists are stable
  flights: 10 * 60 * 1000,            // 10 minutes (was 5) - users search once per session
  flightPrice: 3 * 60 * 1000,         // 3 minutes (was 2) - slight buffer for checkout
  hotels: 30 * 60 * 1000,             // 30 minutes (was 15) - availability more stable than price
  hotelOffer: 10 * 60 * 1000,         // 10 minutes (was 5) - offers remain valid longer
} as const;

export type CacheType = keyof typeof CACHE_TTL;

// In-memory cache store
const memoryCache = new Map<string, CacheEntry>();

// Cache statistics
let cacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0,
};

/**
 * Generate a consistent cache key from type and parameters
 *
 * @param type - The type of data being cached
 * @param params - Object containing search/request parameters
 * @returns Deterministic cache key string
 */
export function getCacheKey(
  type: string,
  params: Record<string, unknown>
): string {
  // Sort keys for consistent ordering
  const sortedParams = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => {
      const value = params[k];
      // Handle arrays and objects
      if (Array.isArray(value)) {
        return `${k}=${value.sort().join(',')}`;
      }
      if (typeof value === 'object') {
        return `${k}=${JSON.stringify(value)}`;
      }
      return `${k}=${value}`;
    })
    .join('&');

  return `amadeus:${type}:${sortedParams}`;
}

/**
 * Retrieve data from cache if valid
 *
 * @param key - Cache key
 * @returns Cached data or null if not found/expired
 */
export function getFromCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);

  if (!entry) {
    cacheStats.misses++;
    return null;
  }

  // Check expiration
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    cacheStats.misses++;
    cacheStats.evictions++;
    return null;
  }

  // Update hit count and return
  entry.hits++;
  cacheStats.hits++;
  return entry.data as T;
}

/**
 * Store data in cache with appropriate TTL
 *
 * @param key - Cache key
 * @param data - Data to cache
 * @param type - Cache type (determines TTL)
 */
export function setCache<T>(key: string, data: T, type: CacheType): void {
  const ttl = CACHE_TTL[type];
  const now = Date.now();

  memoryCache.set(key, {
    data,
    timestamp: now,
    expiresAt: now + ttl,
    hits: 0,
  });

  cacheStats.sets++;
}

/**
 * Check if a cache entry exists and is valid
 *
 * @param key - Cache key
 * @returns True if valid cache entry exists
 */
export function hasValidCache(key: string): boolean {
  const entry = memoryCache.get(key);
  if (!entry) return false;
  return Date.now() <= entry.expiresAt;
}

/**
 * Invalidate a specific cache entry
 *
 * @param key - Cache key to invalidate
 */
export function invalidateCache(key: string): void {
  memoryCache.delete(key);
}

/**
 * Invalidate all cache entries matching a pattern
 *
 * @param pattern - Prefix pattern to match (e.g., "amadeus:flights:")
 */
export function invalidateCachePattern(pattern: string): void {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(pattern)) {
      memoryCache.delete(key);
      cacheStats.evictions++;
    }
  }
}

/**
 * Clear all cached data
 */
export function clearCache(): void {
  const size = memoryCache.size;
  memoryCache.clear();
  cacheStats.evictions += size;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): typeof cacheStats & {
  size: number;
  hitRate: string;
} {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? ((cacheStats.hits / total) * 100).toFixed(1) : '0.0';

  return {
    ...cacheStats,
    size: memoryCache.size,
    hitRate: `${hitRate}%`,
  };
}

/**
 * Reset cache statistics
 */
export function resetCacheStats(): void {
  cacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
  };
}

/**
 * Get cache entry metadata (for debugging)
 */
export function getCacheEntryInfo(key: string): {
  exists: boolean;
  valid: boolean;
  age?: number;
  ttlRemaining?: number;
  hits?: number;
} | null {
  const entry = memoryCache.get(key);

  if (!entry) {
    return { exists: false, valid: false };
  }

  const now = Date.now();
  return {
    exists: true,
    valid: now <= entry.expiresAt,
    age: now - entry.timestamp,
    ttlRemaining: Math.max(0, entry.expiresAt - now),
    hits: entry.hits,
  };
}

/**
 * Cleanup expired entries
 * Called periodically to free memory
 */
export function cleanupExpiredEntries(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.expiresAt) {
      memoryCache.delete(key);
      cleaned++;
      cacheStats.evictions++;
    }
  }

  return cleaned;
}

// Periodic cleanup every minute (only in non-test environment)
if (typeof setInterval !== 'undefined' && process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const cleaned = cleanupExpiredEntries();
    if (cleaned > 0) {
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }, 60 * 1000);
}

/**
 * Wrapper function for cached API calls
 *
 * @example
 * const result = await withCache(
 *   'flights',
 *   { origin: 'JFK', destination: 'CDG', date: '2025-06-01' },
 *   () => searchFlights(params)
 * );
 */
export async function withCache<T>(
  type: CacheType,
  params: Record<string, unknown>,
  fetcher: () => Promise<T>
): Promise<{ data: T; cached: boolean }> {
  const cacheKey = getCacheKey(type, params);

  // Try cache first
  const cached = getFromCache<T>(cacheKey);
  if (cached !== null) {
    return { data: cached, cached: true };
  }

  // Fetch fresh data
  const data = await fetcher();

  // Cache the result
  setCache(cacheKey, data, type);

  return { data, cached: false };
}
