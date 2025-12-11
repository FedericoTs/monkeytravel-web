/**
 * Geo Utilities for Activity-Based Hotel Filtering
 *
 * These utilities help calculate the optimal hotel search location
 * based on the geographic distribution of trip activities.
 */

import type { Activity, ItineraryDay } from '@/types';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeoCenter {
  center: Coordinates;
  radius: number; // in kilometers
  activityCount: number;
  coverage: number; // percentage of activities with coordinates
}

/**
 * Extract all coordinates from an itinerary
 */
export function extractActivityCoordinates(
  itinerary: ItineraryDay[]
): Coordinates[] {
  const coordinates: Coordinates[] = [];

  for (const day of itinerary) {
    for (const activity of day.activities) {
      if (activity.coordinates?.lat && activity.coordinates?.lng) {
        coordinates.push({
          lat: activity.coordinates.lat,
          lng: activity.coordinates.lng,
        });
      }
    }
  }

  return coordinates;
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
 * Calculate the distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
export function calculateDistance(
  coord1: Coordinates,
  coord2: Coordinates
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(coord2.lat - coord1.lat);
  const dLng = toRadians(coord2.lng - coord1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(coord1.lat)) *
      Math.cos(toRadians(coord2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the optimal search radius to cover all activities
 * Returns radius in kilometers, with a minimum of 2km and maximum of 15km
 */
export function calculateOptimalRadius(
  centroid: Coordinates,
  coordinates: Coordinates[]
): number {
  if (coordinates.length === 0) return 5; // Default 5km

  const distances = coordinates.map((c) => calculateDistance(centroid, c));
  const maxDistance = Math.max(...distances);

  // Add 20% buffer for hotel options slightly outside activity zone
  const radius = maxDistance * 1.2;

  // Clamp between 2km minimum (walking distance) and 15km maximum
  return Math.max(2, Math.min(15, radius));
}

/**
 * Get the optimal hotel search center from an itinerary
 * Returns centroid, optimal radius, and coverage statistics
 */
export function getHotelSearchCenter(itinerary: ItineraryDay[]): GeoCenter | null {
  // Count total activities
  let totalActivities = 0;
  for (const day of itinerary) {
    totalActivities += day.activities.length;
  }

  if (totalActivities === 0) return null;

  // Extract coordinates
  const coordinates = extractActivityCoordinates(itinerary);

  if (coordinates.length === 0) {
    return null; // No coordinates available, fall back to city search
  }

  // Calculate centroid
  const centroid = calculateCentroid(coordinates);
  if (!centroid) return null;

  // Calculate optimal radius
  const radius = calculateOptimalRadius(centroid, coordinates);

  return {
    center: centroid,
    radius,
    activityCount: coordinates.length,
    coverage: (coordinates.length / totalActivities) * 100,
  };
}

/**
 * Calculate distance from a hotel to the activity center
 * Useful for displaying proximity information on hotel cards
 */
export function getDistanceFromCenter(
  hotelCoordinates: Coordinates,
  center: Coordinates
): number {
  return calculateDistance(hotelCoordinates, center);
}

/**
 * Format distance for display
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
}

/**
 * Get a human-readable proximity description
 */
export function getProximityLabel(km: number): {
  label: string;
  color: string;
} {
  if (km < 0.5) {
    return { label: 'Walking distance', color: 'text-green-600' };
  }
  if (km < 2) {
    return { label: 'Very close', color: 'text-green-500' };
  }
  if (km < 5) {
    return { label: 'Nearby', color: 'text-blue-500' };
  }
  if (km < 10) {
    return { label: 'Short commute', color: 'text-yellow-600' };
  }
  return { label: 'Further away', color: 'text-orange-500' };
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
  const lngOffset = radiusKm / (111 * Math.cos(toRadians(center.lat)));

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
    .filter(a => a.coordinates?.lat && a.coordinates?.lng)
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
