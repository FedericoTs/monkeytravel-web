/**
 * External API Base URLs
 *
 * Centralized constants for all third-party API endpoints.
 * This ensures consistency and makes it easy to update URLs if needed.
 */

// Google APIs
export const GOOGLE_MAPS_API_BASE = "https://maps.googleapis.com/maps/api";
export const GOOGLE_PLACES_API_BASE = "https://places.googleapis.com/v1";
export const GOOGLE_OAUTH_BASE = "https://oauth2.googleapis.com";
export const GOOGLE_BILLING_BASE = "https://cloudbilling.googleapis.com";

// Image APIs
export const PEXELS_API_BASE = "https://api.pexels.com/v1";

// Weather APIs
export const OPEN_METEO_API_BASE = "https://api.open-meteo.com/v1";

// Currency APIs
export const FRANKFURTER_API_BASE = "https://api.frankfurter.dev/v1";

// Grouped export for convenience
export const EXTERNAL_APIS = {
  google: {
    maps: GOOGLE_MAPS_API_BASE,
    places: GOOGLE_PLACES_API_BASE,
    oauth: GOOGLE_OAUTH_BASE,
    billing: GOOGLE_BILLING_BASE,
  },
  pexels: PEXELS_API_BASE,
  openMeteo: OPEN_METEO_API_BASE,
  frankfurter: FRANKFURTER_API_BASE,
} as const;
