/**
 * Where to put a new activity, from the places the day already has.
 */

import type { Activity } from '@/types';
import { toRadians as toRad } from '@/lib/math/distance';
import { isRealPoint } from '@/lib/trip/placeholder-point';

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Calculate the geographic centroid of a set of coordinates
 * Uses simple averaging for small geographic areas (works well for city-scale)
 */
export function calculateCentroid(coordinates: Coordinates[]): Coordinates | null {
  if (coordinates.length === 0) return null;

  const sumLat = coordinates.reduce((sum, c) => sum + c.lat, 0);
  const sumLng = coordinates.reduce((sum, c) => sum + c.lng, 0);

  return {
    lat: sumLat / coordinates.length,
    lng: sumLng / coordinates.length,
  };
}

/**
 * Generate coordinates near a center point with a small random offset
 * Useful for placing new activities near existing ones without overlap
 * @param center - The center coordinates
 * @param radiusKm - Maximum offset radius in kilometers (default 0.5km)
 */
export function generateNearbyCoordinates(
  center: Coordinates,
  radiusKm: number = 0.5
): Coordinates {
  // Convert radius to approximate degree offset (rough approximation)
  // 1 degree lat ≈ 111km, 1 degree lng ≈ 111km * cos(lat)
  const latOffset = radiusKm / 111;
  const lngOffset = radiusKm / (111 * Math.cos(toRad(center.lat)));

  // Random angle and distance
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * 0.8 + 0.2; // 20-100% of radius

  return {
    lat: center.lat + (Math.sin(angle) * latOffset * distance),
    lng: center.lng + (Math.cos(angle) * lngOffset * distance),
  };
}

/**
 * Get coordinates for a new activity based on existing activities on the same day
 * Falls back to destination center if no existing coordinates
 */
export function getCoordinatesForNewActivity(
  existingActivities: Activity[],
  destinationCoords?: Coordinates
): Coordinates | undefined {
  // Try to get centroid of existing activities with coordinates
  const activityCoords = existingActivities
    .filter(a => isRealPoint(a.coordinates))
    .map(a => a.coordinates as Coordinates);

  if (activityCoords.length > 0) {
    const centroid = calculateCentroid(activityCoords);
    if (centroid) {
      // Generate coordinates near the activity cluster
      return generateNearbyCoordinates(centroid, 0.3);
    }
  }

  // Fall back to destination center with offset
  if (destinationCoords) {
    return generateNearbyCoordinates(destinationCoords, 1.5);
  }

  return undefined;
}
