/**
 * API Gateway Configuration
 *
 * Centralized configuration for API costs, rate limits, and defaults.
 */

import type { ApiCostConfig, RateLimitConfig, RetryConfig, CircuitBreakerConfig } from "./types";

/**
 * Cost per API request in USD
 * Used for tracking and budgeting
 */
export const API_COSTS: ApiCostConfig = {
  // Google APIs
  google_places_search: 0.017,
  google_places_autocomplete: 0.00283,
  google_places_details: 0.017,
  google_places_nearby: 0.032,
  google_geocoding: 0.005,
  google_distance_matrix: 0.005, // per element

  // AI APIs
  gemini_generate: 0.003,
  gemini_regenerate: 0.002,

  // Amadeus APIs (estimates based on usage tier)
  amadeus_flights: 0.01,
  amadeus_hotels: 0.01,
  amadeus_locations: 0, // Free tier

  // Free APIs (track for analytics)
  open_meteo: 0,
  pexels: 0,
} as const;

/**
 * Rate limits per API
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  google_places: { perMinute: 100, perDay: 5000 },
  google_geocoding: { perMinute: 50, perDay: 2500 },
  google_distance: { perMinute: 100, perDay: 5000 },
  amadeus: { perMinute: 10, perDay: 2000 },
  gemini: { perMinute: 15, perDay: 1500 },
  pexels: { perMinute: 200, perDay: 20000 },
  open_meteo: { perMinute: 100, perDay: 10000 },
} as const;

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeout: 60000, // 60 seconds
  successThreshold: 2,
};

/**
 * Batch logger configuration
 */
export const BATCH_LOGGER_CONFIG = {
  batchSize: 50,
  flushIntervalMs: 5000, // 5 seconds
  maxQueueSize: 500, // Prevent memory issues
} as const;

/**
 * Default request timeout in ms
 */
export const DEFAULT_TIMEOUT = 30000;

/**
 * Get cost for a specific API
 */
export function getApiCost(apiName: string): number {
  return API_COSTS[apiName] ?? 0;
}

/**
 * Get rate limit for a specific API
 */
export function getRateLimit(apiName: string): RateLimitConfig | null {
  // Map specific endpoints to their rate limit category
  const categoryMap: Record<string, string> = {
    google_places_search: "google_places",
    google_places_autocomplete: "google_places",
    google_places_details: "google_places",
    google_places_nearby: "google_places",
    google_geocoding: "google_geocoding",
    google_distance_matrix: "google_distance",
    gemini_generate: "gemini",
    gemini_regenerate: "gemini",
    amadeus_flights: "amadeus",
    amadeus_hotels: "amadeus",
    amadeus_locations: "amadeus",
  };

  const category = categoryMap[apiName] || apiName;
  return RATE_LIMITS[category] || null;
}
