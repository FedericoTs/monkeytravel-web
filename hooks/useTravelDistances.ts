"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ItineraryDay, CachedDayTravelData } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import { estimateTravelTime as estimateLeg } from "@/lib/utils/travel-estimation";

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

// Haversine estimates (lib/utils/travel-estimation), worked out in the
// browser with no API call; "~" marks them as approximate.
function estimateTravelTime(origin: Coordinates, destination: Coordinates) {
  const { mode, distanceMeters, durationSeconds, distanceText, durationText } = estimateLeg(origin, destination);
  return { mode, distanceMeters, durationSeconds, distanceText: `~${distanceText}`, durationText: `~${durationText}` };
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

          // Check if we have coordinates for both activities (a placeholder
          // point made the leg thousands of kilometres)
          const fromCoords = fromActivity.coordinates;
          const toCoords = toActivity.coordinates;

          if (isRealPoint(fromCoords) && isRealPoint(toCoords)) {
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

  // Load from cache if available, otherwise calculate locally
  useEffect(() => {
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
  }, [itineraryHash, canUseCache]);

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
