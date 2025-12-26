"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ItineraryDay, CachedDayTravelData } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";

export interface TravelSegment {
  fromActivityId: string;
  toActivityId: string;
  fromActivityName: string;
  toActivityName: string;
  origin: Coordinates;
  destination: Coordinates;
  mode: "WALKING" | "DRIVING" | "TRANSIT";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
}

export interface DayTravelData {
  dayNumber: number;
  segments: TravelSegment[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  isLoading: boolean;
  error?: string;
}

interface UseTravelDistancesResult {
  travelData: Map<number, DayTravelData>;
  isLoading: boolean;
  error?: string;
  refetch: () => void;
  getSegmentBetween: (fromActivityId: string, toActivityId: string) => TravelSegment | undefined;
}

/** Options for the useTravelDistances hook */
interface UseTravelDistancesOptions {
  /** Trip ID for persisting travel distances to database */
  tripId?: string;
  /** Cached travel data from trip_meta (pre-loaded from DB) */
  cachedTravelData?: CachedDayTravelData[];
  /** Hash of itinerary when cached data was calculated */
  cachedHash?: string;
}

// ============================================================
// LOCAL HAVERSINE-BASED TRAVEL ESTIMATION
// No API calls needed - all calculations done in browser
// ============================================================

/**
 * Calculate straight-line distance using Haversine formula
 * @returns Distance in meters
 */
function calculateHaversineDistance(
  origin: Coordinates,
  destination: Coordinates
): number {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = (origin.lat * Math.PI) / 180;
  const lat2Rad = (destination.lat * Math.PI) / 180;
  const deltaLat = ((destination.lat - origin.lat) * Math.PI) / 180;
  const deltaLng = ((destination.lng - origin.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Estimate road distance from straight-line distance
 * Research-based road factors accounting for urban grid patterns
 */
function estimateRoadDistance(straightLineMeters: number): number {
  let factor: number;
  if (straightLineMeters < 500) {
    factor = 1.2;
  } else if (straightLineMeters < 2000) {
    factor = 1.3;
  } else if (straightLineMeters < 5000) {
    factor = 1.35;
  } else {
    factor = 1.4;
  }
  return Math.round(straightLineMeters * factor);
}

/**
 * Estimate walking path distance (more direct than driving)
 */
function estimateWalkingDistance(straightLineMeters: number): number {
  const factor = straightLineMeters < 1000 ? 1.15 : 1.2;
  return Math.round(straightLineMeters * factor);
}

/**
 * Get average speed based on mode and distance
 */
function getAverageSpeed(mode: "WALKING" | "DRIVING", distanceMeters: number): number {
  if (mode === "WALKING") {
    return 4.8; // km/h - comfortable walking pace
  }
  // Driving speeds vary by distance
  if (distanceMeters < 2000) return 18;
  if (distanceMeters < 5000) return 22;
  if (distanceMeters < 10000) return 28;
  return 35;
}

/**
 * Format distance for display
 */
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format duration for display
 */
function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours} hr ${remainingMins} min` : `${hours} hr`;
}

/**
 * Determine optimal travel mode based on distance
 * Walk if under 1.2km (about 15-20 min walk)
 */
function determineOptimalMode(
  origin: Coordinates,
  destination: Coordinates
): "WALKING" | "DRIVING" {
  const straightLine = calculateHaversineDistance(origin, destination);
  return straightLine < 1200 ? "WALKING" : "DRIVING";
}

/**
 * Calculate travel estimate between two coordinates locally
 * No API call needed!
 */
function estimateTravelTime(
  origin: Coordinates,
  destination: Coordinates
): {
  mode: "WALKING" | "DRIVING";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
} {
  const straightLineDistance = calculateHaversineDistance(origin, destination);
  const mode = determineOptimalMode(origin, destination);

  const travelDistance = mode === "WALKING"
    ? estimateWalkingDistance(straightLineDistance)
    : estimateRoadDistance(straightLineDistance);

  const avgSpeedKmh = getAverageSpeed(mode, travelDistance);
  const avgSpeedMs = avgSpeedKmh * 1000 / 3600;
  const durationSeconds = Math.round(travelDistance / avgSpeedMs);

  // Buffer time for crossings/traffic
  const bufferSeconds = mode === "WALKING"
    ? Math.round(travelDistance / 200) * 15
    : Math.round(travelDistance / 500) * 30;

  const totalDurationSeconds = durationSeconds + bufferSeconds;

  return {
    mode,
    distanceMeters: travelDistance,
    durationSeconds: totalDurationSeconds,
    distanceText: `~${formatDistance(travelDistance)}`,
    durationText: `~${formatDuration(totalDurationSeconds)}`,
  };
}

// ============================================================
// HOOK IMPLEMENTATION
// ============================================================

/**
 * Generate a stable hash for the itinerary to detect real changes
 */
function getItineraryHash(itinerary: ItineraryDay[] | undefined): string {
  if (!itinerary) return "";
  return itinerary
    .map((day) =>
      day.activities
        .map((a) => `${a.id || a.name}:${a.coordinates?.lat || 0},${a.coordinates?.lng || 0}`)
        .join("|")
    )
    .join("||");
}

/**
 * Hook to calculate travel distances between consecutive activities in an itinerary
 * Uses LOCAL HAVERSINE CALCULATION - no API calls!
 * Results are cached in trip_meta for persistence across page loads.
 *
 * @param itinerary - The trip itinerary with activities
 * @param options - Optional configuration including cached data and tripId for persistence
 */
export function useTravelDistances(
  itinerary: ItineraryDay[] | undefined,
  options?: UseTravelDistancesOptions
): UseTravelDistancesResult {
  const { tripId, cachedTravelData, cachedHash } = options || {};

  const [travelData, setTravelData] = useState<Map<number, DayTravelData>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);
  const [error, setError] = useState<string>();

  // Track what we've calculated to prevent re-calculating
  const calculatedHashRef = useRef<string>("");
  const isCalculatingRef = useRef(false);
  const hasUsedCacheRef = useRef(false);

  // Stable hash of itinerary to detect real changes
  const itineraryHash = useMemo(() => getItineraryHash(itinerary), [itinerary]);

  // Check if we can use cached data (hash matches current itinerary)
  const canUseCache = useMemo(() => {
    return cachedTravelData &&
           cachedTravelData.length > 0 &&
           cachedHash === itineraryHash;
  }, [cachedTravelData, cachedHash, itineraryHash]);

  const calculateTravelData = useCallback((forceRecalculate = false) => {
    if (!itinerary || itinerary.length === 0) {
      setIsLoading(false);
      return;
    }

    // Prevent duplicate calculations
    if (isCalculatingRef.current) return;

    // Skip if we've already calculated for this exact itinerary (unless forced)
    if (!forceRecalculate && calculatedHashRef.current === itineraryHash) {
      setIsLoading(false);
      return;
    }

    isCalculatingRef.current = true;
    setIsLoading(true);
    setError(undefined);

    try {
      const newTravelData = new Map<number, DayTravelData>();

      for (const day of itinerary) {
        const activities = day.activities;
        const segments: TravelSegment[] = [];
        let totalDistanceMeters = 0;
        let totalDurationSeconds = 0;

        for (let i = 0; i < activities.length - 1; i++) {
          const fromActivity = activities[i];
          const toActivity = activities[i + 1];

          const fromId = fromActivity.id || `${day.day_number}-${i}`;
          const toId = toActivity.id || `${day.day_number}-${i + 1}`;

          // Check if we have coordinates for both activities
          const fromCoords = fromActivity.coordinates;
          const toCoords = toActivity.coordinates;

          if (fromCoords?.lat && fromCoords?.lng && toCoords?.lat && toCoords?.lng) {
            // Calculate travel estimate locally - NO API CALL!
            const estimate = estimateTravelTime(fromCoords, toCoords);

            const segment: TravelSegment = {
              fromActivityId: fromId,
              toActivityId: toId,
              fromActivityName: fromActivity.name,
              toActivityName: toActivity.name,
              origin: fromCoords,
              destination: toCoords,
              mode: estimate.mode,
              distanceMeters: estimate.distanceMeters,
              durationSeconds: estimate.durationSeconds,
              distanceText: estimate.distanceText,
              durationText: estimate.durationText,
            };

            segments.push(segment);
            totalDistanceMeters += estimate.distanceMeters;
            totalDurationSeconds += estimate.durationSeconds;
          }
          // If no coordinates, we skip this segment (can't estimate without coords)
        }

        newTravelData.set(day.day_number, {
          dayNumber: day.day_number,
          segments,
          totalDistanceMeters,
          totalDurationSeconds,
          isLoading: false,
        });
      }

      setTravelData(newTravelData);
      calculatedHashRef.current = itineraryHash;

      // Persist to database if tripId provided (fire-and-forget)
      if (tripId && newTravelData.size > 0) {
        const cacheData: CachedDayTravelData[] = [];
        for (const [, dayData] of newTravelData) {
          cacheData.push({
            dayNumber: dayData.dayNumber,
            segments: dayData.segments.map(s => ({
              fromActivityId: s.fromActivityId,
              toActivityId: s.toActivityId,
              mode: s.mode,
              distanceMeters: s.distanceMeters,
              durationSeconds: s.durationSeconds,
              distanceText: s.distanceText,
              durationText: s.durationText,
            })),
            totalDistanceMeters: dayData.totalDistanceMeters,
            totalDurationSeconds: dayData.totalDurationSeconds,
          });
        }

        // Save to trip_meta (fire-and-forget)
        fetch(`/api/trips/${tripId}/travel-cache`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            travel_distances: cacheData,
            travel_distances_hash: itineraryHash,
          }),
        }).catch(err => console.warn("[TravelDistances] Failed to cache:", err));
      }
    } catch (err) {
      console.error("Failed to calculate travel distances:", err);
      setError("Failed to calculate travel distances");
    } finally {
      setIsLoading(false);
      isCalculatingRef.current = false;
    }
  }, [itinerary, itineraryHash, tripId]);

  // Track mount state to prevent hydration mismatch
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Load from cache if available, otherwise calculate locally
  useEffect(() => {
    if (!hasMounted) return;

    // Use cached data if available and hash matches
    if (canUseCache && cachedTravelData && !hasUsedCacheRef.current) {
      hasUsedCacheRef.current = true;
      console.log("[TravelDistances] Using cached data from database (no API call)");

      const cachedMap = new Map<number, DayTravelData>();
      for (const dayCache of cachedTravelData) {
        cachedMap.set(dayCache.dayNumber, {
          dayNumber: dayCache.dayNumber,
          segments: dayCache.segments.map(s => ({
            ...s,
            fromActivityName: "", // Not stored in cache
            toActivityName: "",
            origin: { lat: 0, lng: 0 },
            destination: { lat: 0, lng: 0 },
          })),
          totalDistanceMeters: dayCache.totalDistanceMeters,
          totalDurationSeconds: dayCache.totalDurationSeconds,
          isLoading: false,
        });
      }

      setTravelData(cachedMap);
      calculatedHashRef.current = itineraryHash;
      setIsLoading(false);
      return;
    }

    // Calculate locally if no cache or hash mismatch
    if (itineraryHash) {
      console.log("[TravelDistances] Calculating locally with Haversine (no API call)");
      calculateTravelData();
    } else {
      // No itinerary, stop loading
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMounted, itineraryHash, canUseCache]);

  // Helper to get segment between two activities
  const getSegmentBetween = useCallback(
    (fromActivityId: string, toActivityId: string): TravelSegment | undefined => {
      for (const [, dayData] of travelData) {
        const segment = dayData.segments.find(
          (s) => s.fromActivityId === fromActivityId && s.toActivityId === toActivityId
        );
        if (segment) return segment;
      }
      return undefined;
    },
    [travelData]
  );

  // Force recalculate function
  const refetch = useCallback(() => {
    hasUsedCacheRef.current = false;
    calculateTravelData(true);
  }, [calculateTravelData]);

  return {
    travelData,
    isLoading,
    error,
    refetch,
    getSegmentBetween,
  };
}
