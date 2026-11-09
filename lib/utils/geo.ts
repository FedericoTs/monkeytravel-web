/**
 * A point on the map, and one near it.
 */

import { toRadians as toRad } from '@/lib/math/distance';

export interface Coordinates {
  lat: number;
  lng: number;
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
