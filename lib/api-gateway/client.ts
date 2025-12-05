/**
 * API Gateway Client
 *
 * Centralized client for all external API requests. Provides:
 * - Automatic logging with cost tracking
 * - Retry with exponential backoff
 * - Circuit breaker protection
 * - Request deduplication
 */

import { getApiCost } from "./config";
import { batchLogger, createLoggingInterceptor, logCacheHit } from "./interceptors/logging";
import { fetchWithRetry } from "./interceptors/retry";
import {
  circuitBreakerManager,
  withCircuitBreaker,
  CircuitOpenError,
} from "./interceptors/circuit-breaker";
import type { ApiRequestConfig, GatewayFetchOptions } from "./types";

/**
 * In-flight request cache for deduplication
 */
const inFlightRequests = new Map<string, Promise<Response>>();

/**
 * Generate cache key for deduplication
 */
function getDedupeKey(url: string, options: RequestInit): string {
  const method = options.method || "GET";
  const body = options.body ? String(options.body) : "";
  return `${method}:${url}:${body}`;
}

/**
 * API Gateway class
 */
class ApiGateway {
  private loggingInterceptor = createLoggingInterceptor();

  /**
   * Execute an API request through the gateway
   */
  async fetch<T = unknown>(
    url: string,
    options: RequestInit = {},
    config: ApiRequestConfig
  ): Promise<{ response: Response; data: T }> {
    const startTime = Date.now();
    const dedupeKey = getDedupeKey(url, options);

    // Check circuit breaker
    if (!circuitBreakerManager.canExecute(config.apiName)) {
      const error = new CircuitOpenError(config.apiName);
      await this.loggingInterceptor.onError?.(error, config, startTime);
      throw error;
    }

    // Deduplication: if identical request is in-flight, wait for it
    if (!config.skipDedup && inFlightRequests.has(dedupeKey)) {
      console.log(`[ApiGateway] Deduplicating request to ${config.apiName}`);
      const existingRequest = inFlightRequests.get(dedupeKey)!;
      const response = await existingRequest.then((r) => r.clone());
      const data = await response.clone().json();
      return { response, data };
    }

    // Create the request promise
    const requestPromise = this.executeRequest<T>(url, options, config, startTime);

    // Store in-flight request for deduplication (only for GET requests)
    const method = options.method || "GET";
    if (method === "GET" && !config.skipDedup) {
      inFlightRequests.set(dedupeKey, requestPromise.then((r) => r.response));

      // Clean up after request completes
      requestPromise.finally(() => {
        inFlightRequests.delete(dedupeKey);
      });
    }

    return requestPromise;
  }

  /**
   * Execute the actual request with all interceptors
   */
  private async executeRequest<T>(
    url: string,
    options: RequestInit,
    config: ApiRequestConfig,
    startTime: number
  ): Promise<{ response: Response; data: T }> {
    try {
      // Use retry wrapper with circuit breaker
      const response = await withCircuitBreaker(config.apiName, () =>
        fetchWithRetry(url, options, {
          maxRetries: config.maxRetries,
        })
      );

      // Calculate cost
      const cost = config.costOverride ?? getApiCost(config.apiName);

      // Log the request
      await this.loggingInterceptor.onResponse?.(
        response.clone(),
        { ...config, costOverride: cost },
        startTime
      );

      // Parse response
      const data = await response.clone().json();

      return { response, data };
    } catch (error) {
      // Log error
      const err = error instanceof Error ? error : new Error(String(error));
      await this.loggingInterceptor.onError?.(err, config, startTime);
      throw error;
    }
  }

  /**
   * Execute request with custom fetch options
   * More flexible version for complex scenarios
   */
  async request<T = unknown>(
    options: GatewayFetchOptions
  ): Promise<{ response: Response; data: T }> {
    const { url, apiName, ...rest } = options;
    return this.fetch<T>(url, rest.fetchOptions || {}, {
      apiName,
      endpoint: options.endpoint || url,
      userId: options.userId,
      costOverride: options.costOverride,
      skipLogging: options.skipLogging,
      maxRetries: options.maxRetries,
      metadata: options.metadata,
      skipDedup: options.skipDedup,
    });
  }

  /**
   * Log a cache hit (when request was served from cache)
   */
  async logCacheHit(config: ApiRequestConfig): Promise<void> {
    await logCacheHit(config);
  }

  /**
   * Force flush all pending logs
   */
  async flushLogs(): Promise<void> {
    await batchLogger.forceFlush();
  }

  /**
   * Get circuit breaker status for all APIs
   */
  getCircuitBreakerStats() {
    return circuitBreakerManager.getAllStats();
  }

  /**
   * Get pending log count
   */
  getPendingLogCount(): number {
    return batchLogger.getBatchSize();
  }

  /**
   * Reset circuit breakers (for testing)
   */
  resetCircuitBreakers(): void {
    circuitBreakerManager.resetAll();
  }
}

// Singleton instance
export const apiGateway = new ApiGateway();

/**
 * Convenience function for simple GET requests
 */
export async function gatewayFetch<T = unknown>(
  url: string,
  config: ApiRequestConfig
): Promise<T> {
  const { data } = await apiGateway.fetch<T>(url, { method: "GET" }, config);
  return data;
}

/**
 * Convenience function for POST requests
 */
export async function gatewayPost<T = unknown>(
  url: string,
  body: unknown,
  config: ApiRequestConfig
): Promise<T> {
  const { data } = await apiGateway.fetch<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    config
  );
  return data;
}

// Re-export error types
export { CircuitOpenError };
