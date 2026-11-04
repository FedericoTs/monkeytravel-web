import type { ItineraryDay } from "@/types";
import { PLACEHOLDER_POINT } from "./placeholder-point";

/**
 * Known destination coordinates for fallback when Gemini doesn't provide coordinates
 * These are approximate city center coordinates
 */
const DESTINATION_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "paris": { lat: 48.8566, lng: 2.3522 },
  "rome": { lat: 41.9028, lng: 12.4964 },
  "tokyo": { lat: 35.6762, lng: 139.6503 },
  "london": { lat: 51.5074, lng: -0.1278 },
  "new york": { lat: 40.7128, lng: -74.0060 },
  "barcelona": { lat: 41.3851, lng: 2.1734 },
  "amsterdam": { lat: 52.3676, lng: 4.9041 },
  "berlin": { lat: 52.5200, lng: 13.4050 },
  "lisbon": { lat: 38.7223, lng: -9.1393 },
  "prague": { lat: 50.0755, lng: 14.4378 },
  "vienna": { lat: 48.2082, lng: 16.3738 },
  "budapest": { lat: 47.4979, lng: 19.0402 },
  "sydney": { lat: -33.8688, lng: 151.2093 },
  "dubai": { lat: 25.2048, lng: 55.2708 },
  "singapore": { lat: 1.3521, lng: 103.8198 },
  "bangkok": { lat: 13.7563, lng: 100.5018 },
  "bali": { lat: -8.3405, lng: 115.0920 },
  "milan": { lat: 45.4642, lng: 9.1900 },
  "florence": { lat: 43.7696, lng: 11.2558 },
  "venice": { lat: 45.4408, lng: 12.3155 },
  "athens": { lat: 37.9838, lng: 23.7275 },
  "madrid": { lat: 40.4168, lng: -3.7038 },
  "seville": { lat: 37.3891, lng: -5.9845 },
  "porto": { lat: 41.1579, lng: -8.6291 },
  "marrakech": { lat: 31.6295, lng: -7.9811 },
  "cairo": { lat: 30.0444, lng: 31.2357 },
  "cape town": { lat: -33.9249, lng: 18.4241 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  "miami": { lat: 25.7617, lng: -80.1918 },
  "chicago": { lat: 41.8781, lng: -87.6298 },
  "toronto": { lat: 43.6532, lng: -79.3832 },
  "mexico city": { lat: 19.4326, lng: -99.1332 },
  "buenos aires": { lat: -34.6037, lng: -58.3816 },
  "rio de janeiro": { lat: -22.9068, lng: -43.1729 },
};

/**
 * Validate and fix coordinates for all activities in the itinerary
 * If coordinates are missing, uses destination-based fallback with small random offset
 *
 * Exported for the assistant's apply_draft path (app/api/ai/assistant) so
 * bulk-revised days get the same coordinate backfill as generated ones.
 */
export function validateAndFixCoordinates(days: ItineraryDay[], destination: string): ItineraryDay[] {
  // Try to find destination coordinates
  const destLower = destination.toLowerCase();
  let destCoords = DESTINATION_COORDINATES[destLower];

  // Try partial match (e.g., "Paris, France" -> "paris")
  if (!destCoords) {
    const firstWord = destLower.split(/[,\s]+/)[0];
    destCoords = DESTINATION_COORDINATES[firstWord];
  }

  // Default fallback (center of Europe if nothing matches)
  if (!destCoords) {
    destCoords = { ...PLACEHOLDER_POINT };
    console.warn(`[Gemini] No known coordinates for destination: ${destination}, using default`);
  }

  let fixedCount = 0;

  const fixedDays = days.map(day => ({
    ...day,
    activities: day.activities.map((activity, idx) => {
      // Check if coordinates are valid
      const hasValidCoords =
        activity.coordinates &&
        typeof activity.coordinates.lat === "number" &&
        typeof activity.coordinates.lng === "number" &&
        !isNaN(activity.coordinates.lat) &&
        !isNaN(activity.coordinates.lng) &&
        activity.coordinates.lat >= -90 &&
        activity.coordinates.lat <= 90 &&
        activity.coordinates.lng >= -180 &&
        activity.coordinates.lng <= 180;

      if (hasValidCoords) {
        return activity;
      }

      // Coordinates are missing or invalid - apply fallback
      // Generate a small random offset (within ~1-2km of city center)
      // This spreads out activities on the map rather than stacking them
      const offsetLat = (Math.random() - 0.5) * 0.02 + (idx * 0.003);
      const offsetLng = (Math.random() - 0.5) * 0.02 + (idx * 0.003);

      const fixedActivity = {
        ...activity,
        coordinates: {
          lat: destCoords.lat + offsetLat,
          lng: destCoords.lng + offsetLng,
        },
      };
      fixedCount++;

      return fixedActivity;
    }),
  }));

  if (fixedCount > 0) {
    console.log(`[Gemini] Fixed ${fixedCount} activities with missing coordinates for ${destination}`);
  }

  return fixedDays;
}
