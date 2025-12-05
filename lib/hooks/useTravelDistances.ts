"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ItineraryDay } from "@/types";

interface Coordinates {
  lat: number;
  lng: number;
}

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

interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId?: string;
  source: "cache" | "api";
}

interface DistanceResult {
  origin: Coordinates;
  destination: Coordinates;
  mode: "WALKING" | "DRIVING" | "TRANSIT";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
  source: "cache" | "api";
}

/**
 * Generate a stable hash for the itinerary to detect real changes
 */
function getItineraryHash(itinerary: ItineraryDay[] | undefined): string {
  if (!itinerary) return "";
  return itinerary
    .map((day) =>
      day.activities
        .map((a) => `${a.id || a.name}:${a.address || a.location}`)
        .join("|")
    )
    .join("||");
}

/**
 * Hook to fetch travel distances between consecutive activities in an itinerary
 * Uses geocoding for addresses without coordinates and caches results
 */
export function useTravelDistances(
  itinerary: ItineraryDay[] | undefined
): UseTravelDistancesResult {
  const [travelData, setTravelData] = useState<Map<number, DayTravelData>>(
    new Map()
  );
  // Start as true to prevent hydration mismatch - server and client both show loading
  const [isLoading, setIsLoading] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);
  const [error, setError] = useState<string>();

  // Track what we've fetched to prevent re-fetching
  const fetchedHashRef = useRef<string>("");
  const isFetchingRef = useRef(false);

  // Stable hash of itinerary to detect real changes
  const itineraryHash = useMemo(() => getItineraryHash(itinerary), [itinerary]);

  // Extract all unique addresses that need geocoding
  const addressesNeedingGeocode = useMemo(() => {
    if (!itinerary) return [];

    const addresses: { dayNumber: number; activityId: string; address: string }[] = [];

    for (const day of itinerary) {
      for (const activity of day.activities) {
        // Skip if already has coordinates
        if (activity.coordinates?.lat && activity.coordinates?.lng) {
          continue;
        }

        const address = activity.address || activity.location;
        if (address) {
          addresses.push({
            dayNumber: day.day_number,
            activityId: activity.id || `${day.day_number}-${activity.name}`,
            address,
          });
        }
      }
    }

    return addresses;
  }, [itinerary]);

  const fetchTravelData = useCallback(async (forceRefresh = false) => {
    if (!itinerary || itinerary.length === 0) return;

    // Prevent duplicate fetches
    if (isFetchingRef.current) return;

    // Skip if we've already fetched this exact itinerary (unless forced)
    if (!forceRefresh && fetchedHashRef.current === itineraryHash) {
      setIsLoading(false);
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(undefined);

    try {
      // Step 1: Geocode addresses that don't have coordinates
      const geocodedCoords: Map<string, Coordinates> = new Map();

      if (addressesNeedingGeocode.length > 0) {
        const uniqueAddresses = [
          ...new Set(addressesNeedingGeocode.map((a) => a.address)),
        ];

        try {
          const geocodeResponse = await fetch("/api/travel/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addresses: uniqueAddresses }),
          });

          if (geocodeResponse.ok) {
            const geocodeData = await geocodeResponse.json();
            for (const result of geocodeData.results as GeocodeResult[]) {
              geocodedCoords.set(result.address, {
                lat: result.lat,
                lng: result.lng,
              });
            }
          } else {
            console.error("Geocode API error:", await geocodeResponse.text());
          }
        } catch (err) {
          console.error("Geocode fetch error:", err);
        }
      }

      // Step 2: Build coordinate pairs for each day
      const newTravelData = new Map<number, DayTravelData>();
      const allPairs: Array<{
        dayNumber: number;
        fromActivityId: string;
        toActivityId: string;
        fromActivityName: string;
        toActivityName: string;
        origin: Coordinates;
        destination: Coordinates;
      }> = [];

      for (const day of itinerary) {
        const activities = day.activities;

        // Initialize day data
        newTravelData.set(day.day_number, {
          dayNumber: day.day_number,
          segments: [],
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          isLoading: true,
        });

        for (let i = 0; i < activities.length - 1; i++) {
          const fromActivity = activities[i];
          const toActivity = activities[i + 1];

          const fromId = fromActivity.id || `${day.day_number}-${i}`;
          const toId = toActivity.id || `${day.day_number}-${i + 1}`;

          // Get coordinates (from activity or geocoded)
          const fromCoords = fromActivity.coordinates?.lat
            ? { lat: fromActivity.coordinates.lat, lng: fromActivity.coordinates.lng }
            : geocodedCoords.get(fromActivity.address || fromActivity.location);

          const toCoords = toActivity.coordinates?.lat
            ? { lat: toActivity.coordinates.lat, lng: toActivity.coordinates.lng }
            : geocodedCoords.get(toActivity.address || toActivity.location);

          if (fromCoords && toCoords) {
            allPairs.push({
              dayNumber: day.day_number,
              fromActivityId: fromId,
              toActivityId: toId,
              fromActivityName: fromActivity.name,
              toActivityName: toActivity.name,
              origin: fromCoords,
              destination: toCoords,
            });
          }
        }
      }

      // Step 3: Fetch distances for all pairs
      if (allPairs.length > 0) {
        try {
          const distanceResponse = await fetch("/api/travel/distance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pairs: allPairs.map((p) => ({
                origin: p.origin,
                destination: p.destination,
              })),
            }),
          });

          if (distanceResponse.ok) {
            const distanceData = await distanceResponse.json();

            // Debug: Log API response summary
            const modes = (distanceData.results as DistanceResult[]).map(r => r.mode);
            const walkingCount = modes.filter(m => m === "WALKING").length;
            const drivingCount = modes.filter(m => m === "DRIVING").length;
            console.log("[TravelDistances] API Response:", {
              totalPairs: allPairs.length,
              totalResults: distanceData.results?.length,
              stats: distanceData.stats,
              walkingResults: walkingCount,
              drivingResults: drivingCount,
            });

            // Match results back to pairs by COORDINATES (not index)
            // This is critical because the API may reorder results or drop failed pairs
            for (const pair of allPairs) {
              // Find matching result by coordinate comparison with tolerance
              const result = (distanceData.results as DistanceResult[]).find(
                (r) =>
                  Math.abs(r.origin.lat - pair.origin.lat) < 0.00001 &&
                  Math.abs(r.origin.lng - pair.origin.lng) < 0.00001 &&
                  Math.abs(r.destination.lat - pair.destination.lat) < 0.00001 &&
                  Math.abs(r.destination.lng - pair.destination.lng) < 0.00001
              );

              if (!result) {
                // No result found for this pair - detailed debug logging
                console.warn(
                  `[TravelDistances] No match for pair: ${pair.fromActivityName} → ${pair.toActivityName}`,
                  {
                    pairOrigin: pair.origin,
                    pairDest: pair.destination,
                    availableResults: (distanceData.results as DistanceResult[]).map(r => ({
                      mode: r.mode,
                      origin: r.origin,
                      dest: r.destination,
                    })),
                  }
                );
                continue;
              }

              const dayData = newTravelData.get(pair.dayNumber);
              if (dayData) {
                const segment: TravelSegment = {
                  fromActivityId: pair.fromActivityId,
                  toActivityId: pair.toActivityId,
                  fromActivityName: pair.fromActivityName,
                  toActivityName: pair.toActivityName,
                  origin: pair.origin,
                  destination: pair.destination,
                  mode: result.mode,
                  distanceMeters: result.distanceMeters,
                  durationSeconds: result.durationSeconds,
                  distanceText: result.distanceText,
                  durationText: result.durationText,
                };

                dayData.segments.push(segment);
                dayData.totalDistanceMeters += result.distanceMeters;
                dayData.totalDurationSeconds += result.durationSeconds;
              }
            }
          } else {
            console.error("Distance API error:", await distanceResponse.text());
          }
        } catch (err) {
          console.error("Distance fetch error:", err);
        }
      }

      // Mark all days as loaded
      for (const [, data] of newTravelData) {
        data.isLoading = false;
      }

      setTravelData(newTravelData);
      fetchedHashRef.current = itineraryHash;
    } catch (err) {
      console.error("Failed to fetch travel distances:", err);
      setError("Failed to calculate travel distances");
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [itinerary, addressesNeedingGeocode, itineraryHash]);

  // Track mount state to prevent hydration mismatch
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Fetch on mount and when itinerary hash changes
  useEffect(() => {
    if (!hasMounted) return;

    if (itineraryHash) {
      fetchTravelData();
    } else {
      // No itinerary, stop loading
      setIsLoading(false);
    }
    // Only depend on hasMounted and itineraryHash to prevent re-fetching loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMounted, itineraryHash]);

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

  // Force refresh function
  const refetch = useCallback(() => {
    fetchTravelData(true);
  }, [fetchTravelData]);

  return {
    travelData,
    isLoading,
    error,
    refetch,
    getSegmentBetween,
  };
}
