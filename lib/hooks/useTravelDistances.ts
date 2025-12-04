"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
 * Hook to fetch travel distances between consecutive activities in an itinerary
 * Uses geocoding for addresses without coordinates and caches results
 */
export function useTravelDistances(
  itinerary: ItineraryDay[] | undefined
): UseTravelDistancesResult {
  const [travelData, setTravelData] = useState<Map<number, DayTravelData>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

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

  const fetchTravelData = useCallback(async () => {
    if (!itinerary || itinerary.length === 0) return;

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

            // Match results back to pairs and days
            for (let i = 0; i < distanceData.results.length; i++) {
              const result = distanceData.results[i] as DistanceResult;
              const pair = allPairs[i];

              if (!pair) continue;

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
    } catch (err) {
      console.error("Failed to fetch travel distances:", err);
      setError("Failed to calculate travel distances");
    } finally {
      setIsLoading(false);
    }
  }, [itinerary, addressesNeedingGeocode]);

  // Fetch on mount and when itinerary changes
  useEffect(() => {
    if (itinerary && itinerary.length > 0) {
      fetchTravelData();
    }
  }, [fetchTravelData]);

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

  return {
    travelData,
    isLoading,
    error,
    refetch: fetchTravelData,
    getSegmentBetween,
  };
}
