/**
 * API Gateway
 *
 * Centralized gateway for all external API requests.
 * Provides logging, retry, circuit breaker, and cost tracking.
 *
 * @example
 * ```typescript
 * import { apiGateway, gatewayFetch } from '@/lib/api-gateway';
 *
 * // Simple GET request
 * const data = await gatewayFetch<PlaceResult[]>(url, {
 *   apiName: 'google_places_search',
 *   endpoint: '/places/search',
 *   userId: session?.user?.id,
 * });
 *
 * // Full control
 * const { response, data } = await apiGateway.fetch<ApiResponse>(
 *   url,
 *   { method: 'POST', body: JSON.stringify(payload) },
 *   { apiName: 'gemini_generate', endpoint: '/generate' }
 * );
 *
 * // Log cache hit
 * await apiGateway.logCacheHit({
 *   apiName: 'google_places_search',
 *   endpoint: '/places/search',
 *   userId: session?.user?.id,
 * });
 * ```
 */

// Main client
export {
  apiGateway,
  gatewayFetch,
  gatewayPost,
  CircuitOpenError,
} from "./client";

// Types
export type {
  ApiRequestConfig,
  GatewayFetchOptions,
  LogEntry,
  ApiCostConfig,
  RateLimitConfig,
  RetryConfig,
  CircuitBreakerConfig,
  CircuitState,
  Interceptor,
} from "./types";

// Config
export {
  API_COSTS,
  RATE_LIMITS,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  BATCH_LOGGER_CONFIG,
  DEFAULT_TIMEOUT,
  getApiCost,
  getRateLimit,
} from "./config";

// Interceptors (for advanced usage)
export {
  batchLogger,
  createLoggingInterceptor,
  logCacheHit,
  fetchWithRetry,
  createRetryInterceptor,
  circuitBreakerManager,
  withCircuitBreaker,
} from "./interceptors";
