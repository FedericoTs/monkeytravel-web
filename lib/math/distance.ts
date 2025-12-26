/**
 * Distance Calculation Utilities
 *
 * Consolidated Haversine and road distance estimation functions.
 * Used by: geo.ts, activity-id.ts, routeOptimizer.ts, travel-estimation.ts
 *
 * @example
 * import { calculateHaversineDistance, estimateRoadDistance } from '@/lib/math/distance';
 *
 * const distanceKm = calculateHaversineDistance(origin, destination, 'km');
 * const distanceM = calculateHaversineDistance(origin, destination, 'm');
 * const roadDistance = estimateRoadDistance(straightLineDistance);
 */

import { type Coordinates } from "@/lib/utils/geo";

// Earth's radius
const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_M = 6371000;

/**
 * Convert degrees to radians
 */
export function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate straight-line distance between two coordinates using Haversine formula
 *
 * @param origin - Starting coordinates
 * @param destination - Ending coordinates
 * @param unit - 'km' for kilometers (default), 'm' for meters
 * @returns Distance in the specified unit
 */
export function calculateHaversineDistance(
  origin: Coordinates,
  destination: Coordinates,
  unit: "km" | "m" = "km"
): number {
  const R = unit === "km" ? EARTH_RADIUS_KM : EARTH_RADIUS_M;

  const lat1Rad = toRadians(origin.lat);
  const lat2Rad = toRadians(destination.lat);
  const deltaLat = toRadians(destination.lat - origin.lat);
  const deltaLng = toRadians(destination.lng - origin.lng);

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
 * Alias for backward compatibility with geo.ts
 * @deprecated Use calculateHaversineDistance instead
 */
export function calculateDistance(
  coord1: Coordinates,
  coord2: Coordinates
): number {
  return calculateHaversineDistance(coord1, coord2, "km");
}

/**
 * Estimate actual road distance from straight-line distance
 *
 * Applies distance-based factors for urban navigation:
 * - < 500m: 1.2x (short walks have minimal detours)
 * - 500m - 2km: 1.3x (typical urban grid factor)
 * - 2km - 5km: 1.35x (longer routes, more variance)
 * - > 5km: 1.4x (highway routing, interchanges)
 *
 * @param straightLineDistance - Straight-line distance (in any unit)
 * @returns Estimated road distance (same unit as input)
 */
export function estimateRoadDistance(straightLineDistance: number): number {
  let factor: number;

  if (straightLineDistance < 500) {
    factor = 1.2;
  } else if (straightLineDistance < 2000) {
    factor = 1.3;
  } else if (straightLineDistance < 5000) {
    factor = 1.35;
  } else {
    factor = 1.4;
  }

  return Math.round(straightLineDistance * factor);
}

/**
 * Get average travel speed based on mode and distance
 *
 * @param mode - WALKING or DRIVING
 * @param distanceMeters - Distance in meters
 * @returns Speed in km/h
 */
export function getAverageSpeed(
  mode: "WALKING" | "DRIVING",
  distanceMeters: number
): number {
  if (mode === "WALKING") {
    return 4.8; // km/h - comfortable walking pace
  }

  // Driving speeds vary by distance (urban traffic)
  if (distanceMeters < 2000) return 18;
  if (distanceMeters < 5000) return 22;
  if (distanceMeters < 10000) return 28;
  return 35;
}

/**
 * Calculate travel time between two points
 *
 * @param origin - Starting coordinates
 * @param destination - Ending coordinates
 * @param mode - WALKING or DRIVING (auto-detected if not provided)
 * @returns Travel time in minutes
 */
export function calculateTravelTime(
  origin: Coordinates,
  destination: Coordinates,
  mode?: "WALKING" | "DRIVING"
): number {
  const straightLineM = calculateHaversineDistance(origin, destination, "m");
  const roadDistanceM = estimateRoadDistance(straightLineM);

  // Auto-detect mode: walk if < 1.2km
  const travelMode = mode ?? (straightLineM < 1200 ? "WALKING" : "DRIVING");
  const speedKmH = getAverageSpeed(travelMode, roadDistanceM);

  // Convert: (meters / 1000) / (km/h) * 60 = minutes
  const travelMinutes = (roadDistanceM / 1000 / speedKmH) * 60;

  return Math.round(travelMinutes);
}
