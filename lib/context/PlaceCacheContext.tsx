"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

/**
 * Client-side cache for place data to prevent redundant API calls
 * when the same place appears multiple times in the UI (e.g., activity cards)
 */

interface PlacePhoto {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  attribution: string;
}

export interface CachedPlaceData {
  placeId: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number };
  photos: PlacePhoto[];
  rating?: number;
  reviewCount?: number;
  website?: string;
  googleMapsUrl?: string;
  priceLevel?: number;
  priceLevelSymbol?: string;
  priceLevelLabel?: string;
  priceRange?: string;
  openNow?: boolean;
  openingHours?: string[];
  cachedAt: number; // Timestamp for TTL checks
}

interface PlaceCacheContextType {
  getPlace: (key: string) => CachedPlaceData | null;
  setPlace: (key: string, data: Omit<CachedPlaceData, "cachedAt">) => void;
  hasPlace: (key: string) => boolean;
  getCacheStats: () => { size: number; hits: number; misses: number };
}

const PlaceCacheContext = createContext<PlaceCacheContextType | null>(null);

// Cache configuration
const MAX_CACHE_SIZE = 100; // Max entries to prevent memory issues
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (session-level cache)

// Stats for monitoring
let cacheHits = 0;
let cacheMisses = 0;

export function PlaceCacheProvider({ children }: { children: ReactNode }) {
  // Use useState with Map for persistent cache across renders
  const [cache] = useState(() => new Map<string, CachedPlaceData>());

  const getPlace = useCallback((key: string): CachedPlaceData | null => {
    const cached = cache.get(key);

    if (!cached) {
      cacheMisses++;
      return null;
    }

    // Check TTL
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
      cacheMisses++;
      return null;
    }

    cacheHits++;
    console.log(`[PlaceCache] HIT: ${key.substring(0, 30)}...`);
    return cached;
  }, [cache]);

  const setPlace = useCallback((key: string, data: Omit<CachedPlaceData, "cachedAt">) => {
    // Enforce cache size limit with LRU eviction
    if (cache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entry (first in Map)
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
        console.log(`[PlaceCache] Evicted oldest entry to make room`);
      }
    }

    cache.set(key, {
      ...data,
      cachedAt: Date.now(),
    });

    console.log(`[PlaceCache] Stored: ${key.substring(0, 30)}... (size: ${cache.size})`);
  }, [cache]);

  const hasPlace = useCallback((key: string): boolean => {
    const cached = cache.get(key);
    if (!cached) return false;

    // Check TTL
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
      return false;
    }

    return true;
  }, [cache]);

  const getCacheStats = useCallback(() => ({
    size: cache.size,
    hits: cacheHits,
    misses: cacheMisses,
  }), [cache]);

  return (
    <PlaceCacheContext.Provider value={{ getPlace, setPlace, hasPlace, getCacheStats }}>
      {children}
    </PlaceCacheContext.Provider>
  );
}

export function usePlaceCache() {
  const context = useContext(PlaceCacheContext);
  if (!context) {
    // Return no-op implementation for components outside provider
    // This allows PlaceGallery to work without the provider (with no caching)
    return {
      getPlace: () => null,
      setPlace: () => {},
      hasPlace: () => false,
      getCacheStats: () => ({ size: 0, hits: 0, misses: 0 }),
    };
  }
  return context;
}

/**
 * Generate a cache key from place name and address
 */
export function generatePlaceCacheKey(placeName: string, placeAddress: string): string {
  return `${placeName.toLowerCase().trim()}-${placeAddress.toLowerCase().trim()}`;
}
