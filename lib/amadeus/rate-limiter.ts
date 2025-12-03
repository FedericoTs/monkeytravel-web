/**
 * Rate Limiter for Amadeus API
 *
 * Implements a simple queue-based rate limiter to stay within Amadeus limits:
 * - Test environment: 10 TPS (1 request per 100ms)
 * - Production environment: 20 TPS (1 request per 50ms)
 *
 * Uses a sliding window approach with request queuing.
 */

type QueuedRequest = {
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// Rate limit configuration based on environment
const RATE_LIMITS = {
  test: {
    requestsPerSecond: 10,
    minInterval: 100, // ms between requests
  },
  production: {
    requestsPerSecond: 20,
    minInterval: 50,
  },
};

// Get current environment from process.env
const getEnvironment = (): 'test' | 'production' => {
  return (process.env.AMADEUS_HOSTNAME as 'test' | 'production') || 'test';
};

// Request queue and state
const requestQueue: QueuedRequest[] = [];
let lastRequestTime = 0;
let isProcessing = false;
let requestCount = 0;
let windowStart = Date.now();

// Statistics for monitoring
let stats = {
  totalRequests: 0,
  queuedRequests: 0,
  rateLimitDelays: 0,
  averageWaitTime: 0,
};

/**
 * Process queued requests while respecting rate limits
 */
async function processQueue(): Promise<void> {
  if (isProcessing || requestQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const env = getEnvironment();
  const { minInterval, requestsPerSecond } = RATE_LIMITS[env];

  while (requestQueue.length > 0) {
    const now = Date.now();

    // Reset window counter every second
    if (now - windowStart >= 1000) {
      windowStart = now;
      requestCount = 0;
    }

    // Check if we've hit the per-second limit
    if (requestCount >= requestsPerSecond) {
      const waitTime = 1000 - (now - windowStart) + 10; // Wait for next window + buffer
      stats.rateLimitDelays++;
      await delay(waitTime);
      continue;
    }

    // Ensure minimum interval between requests
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      stats.rateLimitDelays++;
      await delay(waitTime);
    }

    // Execute the request
    const request = requestQueue.shift();
    if (request) {
      lastRequestTime = Date.now();
      requestCount++;
      stats.totalRequests++;

      try {
        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  isProcessing = false;
}

/**
 * Simple delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enqueue a request to be executed with rate limiting
 *
 * @param request - The async function to execute
 * @returns Promise that resolves with the request result
 */
export function enqueueRequest<T>(request: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    stats.queuedRequests++;

    requestQueue.push({
      execute: request as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    // Start processing if not already
    processQueue();
  });
}

/**
 * Get current queue length
 */
export function getQueueLength(): number {
  return requestQueue.length;
}

/**
 * Get rate limiter statistics
 */
export function getRateLimiterStats(): typeof stats & {
  queueLength: number;
  environment: string;
  maxRequestsPerSecond: number;
} {
  const env = getEnvironment();
  return {
    ...stats,
    queueLength: requestQueue.length,
    environment: env,
    maxRequestsPerSecond: RATE_LIMITS[env].requestsPerSecond,
  };
}

/**
 * Reset statistics (useful for testing)
 */
export function resetRateLimiterStats(): void {
  stats = {
    totalRequests: 0,
    queuedRequests: 0,
    rateLimitDelays: 0,
    averageWaitTime: 0,
  };
}

/**
 * Clear the request queue (useful for cleanup)
 */
export function clearQueue(): void {
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      request.reject(new Error('Request queue cleared'));
    }
  }
}

/**
 * Decorator function to wrap any async function with rate limiting
 *
 * @example
 * const rateLimitedSearch = withRateLimit(searchFlights);
 * const results = await rateLimitedSearch(params);
 */
export function withRateLimit<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs) => enqueueRequest(() => fn(...args));
}
