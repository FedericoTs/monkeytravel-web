/**
 * Circuit Breaker Interceptor
 *
 * Prevents cascading failures by "opening" the circuit when an API
 * experiences repeated failures. After a recovery period, allows
 * limited requests through to test if the API has recovered.
 */

import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from "../config";
import type { CircuitState, CircuitBreakerConfig } from "../types";

/**
 * Circuit breaker for a single API
 */
class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly apiName: string;

  constructor(apiName: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.apiName = apiName;
    this.config = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...config,
    };
  }

  /**
   * Check if request can proceed
   */
  canExecute(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      // Check if recovery timeout has passed
      if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
        console.log(`[CircuitBreaker] ${this.apiName}: OPEN -> HALF_OPEN`);
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow limited requests
    return true;
  }

  /**
   * Record a successful request
   */
  onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        console.log(`[CircuitBreaker] ${this.apiName}: HALF_OPEN -> CLOSED`);
      }
    } else if (this.state === "CLOSED") {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      // Immediate return to OPEN on failure during half-open
      this.state = "OPEN";
      console.log(`[CircuitBreaker] ${this.apiName}: HALF_OPEN -> OPEN (failure)`);
    } else if (
      this.state === "CLOSED" &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.state = "OPEN";
      console.warn(
        `[CircuitBreaker] ${this.apiName}: CLOSED -> OPEN ` +
        `(${this.failureCount} failures)`
      );
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Reset circuit breaker (for testing)
   */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Circuit breaker manager - maintains breakers for each API
 */
class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create circuit breaker for an API
   */
  private getBreaker(apiName: string): CircuitBreaker {
    let breaker = this.breakers.get(apiName);
    if (!breaker) {
      breaker = new CircuitBreaker(apiName, this.defaultConfig);
      this.breakers.set(apiName, breaker);
    }
    return breaker;
  }

  /**
   * Check if request can proceed
   */
  canExecute(apiName: string): boolean {
    return this.getBreaker(apiName).canExecute();
  }

  /**
   * Record success
   */
  onSuccess(apiName: string): void {
    this.getBreaker(apiName).onSuccess();
  }

  /**
   * Record failure
   */
  onFailure(apiName: string): void {
    this.getBreaker(apiName).onFailure();
  }

  /**
   * Get state for specific API
   */
  getState(apiName: string): CircuitState {
    return this.getBreaker(apiName).getState();
  }

  /**
   * Get all circuit breaker stats
   */
  getAllStats(): Record<string, ReturnType<CircuitBreaker["getStats"]>> {
    const stats: Record<string, ReturnType<CircuitBreaker["getStats"]>> = {};
    Array.from(this.breakers.entries()).forEach(([apiName, breaker]) => {
      stats[apiName] = breaker.getStats();
    });
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    Array.from(this.breakers.values()).forEach((breaker) => {
      breaker.reset();
    });
  }
}

// Singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(apiName: string) {
    super(`Circuit breaker is OPEN for ${apiName}`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Wrapper to execute with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  apiName: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!circuitBreakerManager.canExecute(apiName)) {
    throw new CircuitOpenError(apiName);
  }

  try {
    const result = await fn();
    circuitBreakerManager.onSuccess(apiName);
    return result;
  } catch (error) {
    circuitBreakerManager.onFailure(apiName);
    throw error;
  }
}
