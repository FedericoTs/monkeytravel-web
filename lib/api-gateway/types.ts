/**
 * API Gateway Type Definitions
 *
 * Core types for the centralized API gateway that handles all external API requests.
 */

/**
 * Configuration for an API request through the gateway
 */
export interface ApiRequestConfig {
  /** Unique identifier for the API (e.g., 'google_places', 'gemini') */
  apiName: string;
  /** Specific endpoint being called */
  endpoint: string;
  /** User ID for per-user cost attribution */
  userId?: string;
  /** Override default cost per request */
  costOverride?: number;
  /** Skip logging for this request */
  skipLogging?: boolean;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Additional metadata to log */
  metadata?: Record<string, unknown>;
  /** Skip request deduplication */
  skipDedup?: boolean;
}

/**
 * Extended fetch options with gateway config
 */
export interface GatewayFetchOptions {
  /** URL to fetch */
  url: string;
  /** API name for logging/tracking */
  apiName: string;
  /** Specific endpoint being called */
  endpoint?: string;
  /** User ID for per-user cost attribution */
  userId?: string;
  /** Override default cost per request */
  costOverride?: number;
  /** Skip logging for this request */
  skipLogging?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Additional metadata to log */
  metadata?: Record<string, unknown>;
  /** Skip request deduplication */
  skipDedup?: boolean;
  /** Standard fetch options */
  fetchOptions?: RequestInit;
}

/**
 * Response wrapper with metadata
 */
export interface ApiResponse<T> {
  /** Response data */
  data: T;
  /** Request metadata */
  meta: {
    /** Whether response came from cache */
    cached: boolean;
    /** Response time in milliseconds */
    responseTimeMs: number;
    /** Estimated cost for this request */
    cost: number;
    /** Number of retry attempts */
    retries: number;
    /** API name */
    apiName: string;
  };
}

/**
 * Log entry for api_request_logs table
 */
export interface LogEntry {
  api_name: string;
  endpoint: string;
  request_params?: Record<string, unknown>;
  response_status: number;
  response_time_ms: number;
  cache_hit: boolean;
  cost_usd: number;
  user_id?: string;
  error_message?: string;
  timestamp?: string;
}

/**
 * Interceptor interface for request/response processing
 */
export interface Interceptor {
  /** Process request before sending */
  onRequest?: (
    url: string,
    options: GatewayFetchOptions
  ) => Promise<{ url: string; options: GatewayFetchOptions }>;

  /** Process successful response */
  onResponse?: (
    response: Response,
    config: ApiRequestConfig,
    startTime: number
  ) => Promise<Response>;

  /** Handle errors */
  onError?: (
    error: Error,
    config: ApiRequestConfig,
    startTime: number
  ) => Promise<Error>;
}

/**
 * Circuit breaker state
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  recoveryTimeout: number;
  /** Number of successful requests to close circuit */
  successThreshold: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay in ms (doubles each retry) */
  baseDelay: number;
  /** Maximum delay in ms */
  maxDelay: number;
  /** HTTP status codes that should trigger retry */
  retryableStatuses: number[];
}

/**
 * API cost configuration
 */
export type ApiCostConfig = Record<string, number>;

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  perMinute: number;
  perDay: number;
}
