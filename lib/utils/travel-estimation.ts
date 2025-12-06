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

interface Coordinates {
  lat: number;
  lng: number;
}

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
 *
 * Research-based road factors:
 * - Very short (<500m): 1.2x (likely nearby streets)
 * - Short (<2km): 1.3x (urban grid, some turns)
 * - Medium (2-5km): 1.35x (more routing complexity)
 * - Long (>5km): 1.4x (major roads, intersections)
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
 * Get realistic average speed based on mode and distance
 *
 * Walking:
 * - Comfortable walking: 4.5-5 km/h
 * - We use 4.8 km/h accounting for crossings/stops
 *
 * Driving (urban):
 * - Short trips (<2km): 15-20 km/h (parking, traffic lights)
 * - Medium trips (2-5km): 20-25 km/h (more traffic)
 * - Longer trips (>5km): 25-35 km/h (may include faster roads)
 */
function getAverageSpeed(mode: "WALKING" | "DRIVING", distanceMeters: number): number {
  if (mode === "WALKING") {
    // 4.8 km/h = 1.33 m/s
    return 4.8;
  }

  // Driving speeds vary by distance (km/h)
  if (distanceMeters < 2000) {
    return 18; // Short urban trips with parking
  } else if (distanceMeters < 5000) {
    return 22; // Medium urban trips
  } else if (distanceMeters < 10000) {
    return 28; // Longer trips, mix of roads
  } else {
    return 35; // May include highways/faster roads
  }
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
