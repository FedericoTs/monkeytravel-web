/**
 * Travel Time Estimation Utility
 *
 * Provides realistic travel time estimates based on coordinates
 * without requiring the Google Distance Matrix API.
 *
 * Uses empirical road factors and speed estimates based on research:
 * - Urban areas: 1.3-1.4x straight-line distance (grid patterns, traffic)
 * - Suburban: 1.2-1.3x (more direct routes)
 * - Walking: Additional factor for pedestrian paths
 */

import { type Coordinates } from "./geo";
import {
  calculateHaversineDistance as calcHaversine,
  estimateRoadDistance,
  getAverageSpeed,
} from "@/lib/math/distance";

export type { Coordinates };

export interface TravelEstimate {
  mode: "WALKING" | "DRIVING";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
  isEstimate: true;
}

/**
 * Calculate straight-line distance using Haversine formula
 * @returns Distance in meters
 */
export function calculateHaversineDistance(
  origin: Coordinates,
  destination: Coordinates
): number {
  return calcHaversine(origin, destination, "m");
}

/**
 * Estimate walking path distance from straight-line
 * Walking paths are often more direct than driving routes
 * but still not straight lines
 */
function estimateWalkingDistance(straightLineMeters: number): number {
  // Walking paths are typically 1.15-1.25x straight line
  // (can use shortcuts, pedestrian paths, etc.)
  const factor = straightLineMeters < 1000 ? 1.15 : 1.2;
  return Math.round(straightLineMeters * factor);
}

/**
 * Determine optimal travel mode based on distance
 * Walk if under 1.2km straight-line (about 15-20 min walk)
 */
export function determineOptimalMode(
  origin: Coordinates,
  destination: Coordinates
): "WALKING" | "DRIVING" {
  const straightLine = calculateHaversineDistance(origin, destination);
  // Walk if under 1.2km (roughly 15-20 min comfortable walk)
  return straightLine < 1200 ? "WALKING" : "DRIVING";
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
 * Estimate travel time between two coordinates
 * Returns realistic estimates without requiring an API call
 */
export function estimateTravelTime(
  origin: Coordinates,
  destination: Coordinates,
  preferredMode?: "WALKING" | "DRIVING" | "AUTO"
): TravelEstimate {
  // Calculate straight-line distance
  const straightLineDistance = calculateHaversineDistance(origin, destination);

  // Determine mode
  const mode: "WALKING" | "DRIVING" =
    preferredMode && preferredMode !== "AUTO"
      ? preferredMode
      : determineOptimalMode(origin, destination);

  // Estimate actual travel distance
  const travelDistance = mode === "WALKING"
    ? estimateWalkingDistance(straightLineDistance)
    : estimateRoadDistance(straightLineDistance);

  // Calculate duration based on average speed
  const avgSpeedKmh = getAverageSpeed(mode, travelDistance);
  const avgSpeedMs = avgSpeedKmh * 1000 / 3600; // Convert to m/s
  const durationSeconds = Math.round(travelDistance / avgSpeedMs);

  // Add buffer time for walking (crossings) or driving (traffic lights, parking)
  const bufferSeconds = mode === "WALKING"
    ? Math.round(travelDistance / 200) * 15 // ~15s per 200m for crossings
    : Math.round(travelDistance / 500) * 30; // ~30s per 500m for lights/turns

  const totalDurationSeconds = durationSeconds + bufferSeconds;

  return {
    mode,
    distanceMeters: travelDistance,
    durationSeconds: totalDurationSeconds,
    distanceText: formatDistance(travelDistance),
    durationText: formatDuration(totalDurationSeconds),
    isEstimate: true,
  };
}

/**
 * Batch estimate travel times for multiple coordinate pairs
 */
export function batchEstimateTravelTimes(
  pairs: Array<{
    origin: Coordinates;
    destination: Coordinates;
    preferredMode?: "WALKING" | "DRIVING" | "AUTO";
  }>
): TravelEstimate[] {
  return pairs.map(({ origin, destination, preferredMode }) =>
    estimateTravelTime(origin, destination, preferredMode)
  );
}
