/**
 * Google API Client
 *
 * Pre-configured client for Google Places, Geocoding, and Distance Matrix APIs.
 * Handles authentication, cost tracking, and field masks automatically.
 */

import { apiGateway } from "../client";
import { API_COSTS } from "../config";
import {
  GOOGLE_MAPS_API_BASE,
  GOOGLE_PLACES_API_BASE,
} from "@/lib/constants/externalApis";

const GOOGLE_API_BASE = GOOGLE_MAPS_API_BASE;
const GOOGLE_PLACES_BASE = GOOGLE_PLACES_API_BASE;

/**
 * Google Places API (New)
 */
export const googlePlaces = {
  /**
   * Text Search (New)
   */
  async textSearch(
    query: string,
    options: {
      userId?: string;
      languageCode?: string;
      maxResultCount?: number;
      locationBias?: { latitude: number; longitude: number; radiusMeters: number };
      includedType?: string;
    } = {}
  ) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

    const body = {
      textQuery: query,
      languageCode: options.languageCode || "en",
      maxResultCount: options.maxResultCount || 10,
      ...(options.locationBias && {
        locationBias: {
          circle: {
            center: {
              latitude: options.locationBias.latitude,
              longitude: options.locationBias.longitude,
            },
            radius: options.locationBias.radiusMeters,
          },
        },
      }),
      ...(options.includedType && { includedType: options.includedType }),
    };

    const { data } = await apiGateway.fetch<{ places: unknown[] }>(
      `${GOOGLE_PLACES_BASE}/places:searchText`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.priceLevel,places.photos,places.primaryType",
        },
        body: JSON.stringify(body),
      },
      {
        apiName: "google_places_search",
        endpoint: "/places:searchText",
        userId: options.userId,
        metadata: { query, ...options },
      }
    );

    return data;
  },

  /**
   * Autocomplete
   */
  async autocomplete(
    input: string,
    options: {
      userId?: string;
      sessionToken?: string;
      languageCode?: string;
      includedRegionCodes?: string[];
    } = {}
  ) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

    const body = {
      input,
      languageCode: options.languageCode || "en",
      ...(options.sessionToken && { sessionToken: options.sessionToken }),
      ...(options.includedRegionCodes && {
        includedRegionCodes: options.includedRegionCodes,
      }),
    };

    const { data } = await apiGateway.fetch<{ suggestions: unknown[] }>(
      `${GOOGLE_PLACES_BASE}/places:autocomplete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify(body),
      },
      {
        apiName: "google_places_autocomplete",
        endpoint: "/places:autocomplete",
        userId: options.userId,
        metadata: { input },
      }
    );

    return data;
  },

  /**
   * Place Details
   */
  async getDetails(
    placeId: string,
    options: {
      userId?: string;
      languageCode?: string;
    } = {}
  ) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

    const { data } = await apiGateway.fetch(
      `${GOOGLE_PLACES_BASE}/places/${placeId}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,location,types,rating,priceLevel,photos,editorialSummary,currentOpeningHours,websiteUri,nationalPhoneNumber",
        },
      },
      {
        apiName: "google_places_details",
        endpoint: `/places/${placeId}`,
        userId: options.userId,
        metadata: { placeId },
      }
    );

    return data;
  },

  /**
   * Nearby Search
   */
  async nearbySearch(
    options: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
      includedTypes?: string[];
      userId?: string;
      maxResultCount?: number;
    }
  ) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

    const body = {
      locationRestriction: {
        circle: {
          center: {
            latitude: options.latitude,
            longitude: options.longitude,
          },
          radius: options.radiusMeters,
        },
      },
      maxResultCount: options.maxResultCount || 20,
      ...(options.includedTypes && { includedTypes: options.includedTypes }),
    };

    const { data } = await apiGateway.fetch<{ places: unknown[] }>(
      `${GOOGLE_PLACES_BASE}/places:searchNearby`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.priceLevel,places.photos",
        },
        body: JSON.stringify(body),
      },
      {
        apiName: "google_places_nearby",
        endpoint: "/places:searchNearby",
        userId: options.userId,
        metadata: {
          lat: options.latitude,
          lng: options.longitude,
          radius: options.radiusMeters,
        },
      }
    );

    return data;
  },
};

/**
 * Google Geocoding API
 */
export const googleGeocoding = {
  /**
   * Forward geocoding (address to coordinates)
   */
  async geocode(
    address: string,
    options: { userId?: string } = {}
  ) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");

    const url = new URL(`${GOOGLE_API_BASE}/geocode/json`);
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);

    const { data } = await apiGateway.fetch<{
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        place_id: string;
      }>;
      status: string;
    }>(
      url.toString(),
      { method: "GET" },
      {
        apiName: "google_geocoding",
        endpoint: "/geocode/json",
        userId: options.userId,
        metadata: { address },
      }
    );

    return data;
  },

  /**
   * Reverse geocoding (coordinates to address)
   */
  async reverseGeocode(
    lat: number,
    lng: number,
    options: { userId?: string } = {}
  ) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");

    const url = new URL(`${GOOGLE_API_BASE}/geocode/json`);
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", apiKey);

    const { data } = await apiGateway.fetch<{
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        place_id: string;
      }>;
      status: string;
    }>(
      url.toString(),
      { method: "GET" },
      {
        apiName: "google_geocoding",
        endpoint: "/geocode/json",
        userId: options.userId,
        metadata: { lat, lng },
      }
    );

    return data;
  },
};

/**
 * Google Distance Matrix API
 */
export const googleDistanceMatrix = {
  /**
   * Calculate distances between origins and destinations
   */
  async calculate(
    origins: string[],
    destinations: string[],
    options: {
      mode?: "driving" | "walking" | "transit" | "bicycling";
      userId?: string;
    } = {}
  ) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");

    const url = new URL(`${GOOGLE_API_BASE}/distancematrix/json`);
    url.searchParams.set("origins", origins.join("|"));
    url.searchParams.set("destinations", destinations.join("|"));
    url.searchParams.set("mode", options.mode || "driving");
    url.searchParams.set("key", apiKey);

    // Cost is per element (origin x destination)
    const elementCount = origins.length * destinations.length;
    const cost = API_COSTS.google_distance_matrix * elementCount;

    const { data } = await apiGateway.fetch<{
      rows: Array<{
        elements: Array<{
          distance: { text: string; value: number };
          duration: { text: string; value: number };
          status: string;
        }>;
      }>;
      status: string;
    }>(
      url.toString(),
      { method: "GET" },
      {
        apiName: "google_distance_matrix",
        endpoint: "/distancematrix/json",
        userId: options.userId,
        costOverride: cost,
        metadata: {
          origins: origins.length,
          destinations: destinations.length,
          mode: options.mode || "driving",
        },
      }
    );

    return data;
  },
};
