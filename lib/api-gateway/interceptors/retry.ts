/**
 * Retry Interceptor with Exponential Backoff
 *
 * Automatically retries failed requests with exponential backoff and jitter.
 * Respects Retry-After headers from rate-limited responses.
 */

import { DEFAULT_RETRY_CONFIG } from "../config";
import type { RetryConfig } from "../types";

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Add random jitter (0-1000ms) to prevent thundering herd
  const jitter = Math.random() * 1000;

  // Cap at maxDelay
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Check if error/status is retryable
 */
function isRetryable(
  status: number,
  retryableStatuses: number[]
): boolean {
  return retryableStatuses.includes(status);
}

/**
 * Parse Retry-After header value
 * Returns delay in milliseconds
 */
function parseRetryAfter(retryAfter: string | null): number | null {
  if (!retryAfter) return null;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a fetch with retry logic
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: Partial<RetryConfig> = {}
): Promise<Response> {
  const {
    maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelay = DEFAULT_RETRY_CONFIG.baseDelay,
    maxDelay = DEFAULT_RETRY_CONFIG.maxDelay,
    retryableStatuses = DEFAULT_RETRY_CONFIG.retryableStatuses,
  } = config;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Success - return response
      if (response.ok) {
        return response;
      }

      // Check if we should retry
      if (!isRetryable(response.status, retryableStatuses)) {
        return response;
      }

      // Last attempt - return the response anyway
      if (attempt === maxRetries) {
        return response;
      }

      lastResponse = response;

      // Calculate delay
      let delay = calculateDelay(attempt, baseDelay, maxDelay);

      // Respect Retry-After header if present
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      if (retryAfter !== null) {
        delay = Math.min(retryAfter, maxDelay);
      }

      console.log(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} for ${url} ` +
        `(status: ${response.status}, delay: ${Math.round(delay)}ms)`
      );

      await sleep(delay);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network errors are retryable
      if (attempt === maxRetries) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, baseDelay, maxDelay);

      console.log(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} for ${url} ` +
        `(error: ${lastError.message}, delay: ${Math.round(delay)}ms)`
      );

      await sleep(delay);
    }
  }

  // Should not reach here, but return last response or throw error
  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error("Retry failed");
}

/**
 * Create retry interceptor (for compatibility with interceptor pattern)
 */
export function createRetryInterceptor(config: Partial<RetryConfig> = {}) {
  return {
    config,
    fetchWithRetry: (url: string, options: RequestInit) =>
      fetchWithRetry(url, options, config),
  };
}
