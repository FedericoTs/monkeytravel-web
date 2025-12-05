/**
 * Batch Logging Interceptor
 *
 * Batches API request logs to reduce database writes by ~90%.
 * Logs are flushed every 5 seconds or when batch reaches 50 entries.
 */

import { createClient } from "@/lib/supabase/server";
import { BATCH_LOGGER_CONFIG } from "../config";
import type { LogEntry, Interceptor, ApiRequestConfig } from "../types";

/**
 * Batch logger singleton
 */
class BatchLogger {
  private batch: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isServer: boolean;

  constructor() {
    this.isServer = typeof window === "undefined";
    if (this.isServer) {
      this.startAutoFlush();
    }
  }

  /**
   * Add a log entry to the batch
   */
  async log(entry: LogEntry): Promise<void> {
    this.batch.push({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    });

    // Flush if batch is full
    if (this.batch.length >= BATCH_LOGGER_CONFIG.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush all pending log entries to database
   */
  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const entries = [...this.batch];
    this.batch = [];

    try {
      const supabase = await createClient();
      const { error } = await supabase.from("api_request_logs").insert(entries);

      if (error) {
        console.error("[ApiGateway] Failed to flush logs:", error);
        // Re-add failed entries (with limit)
        if (this.batch.length < BATCH_LOGGER_CONFIG.maxQueueSize) {
          this.batch.unshift(...entries.slice(0, BATCH_LOGGER_CONFIG.maxQueueSize - this.batch.length));
        }
      } else {
        console.log(`[ApiGateway] Flushed ${entries.length} log entries`);
      }
    } catch (error) {
      console.error("[ApiGateway] Flush error:", error);
      // Re-add on error
      if (this.batch.length < BATCH_LOGGER_CONFIG.maxQueueSize) {
        this.batch.unshift(...entries.slice(0, BATCH_LOGGER_CONFIG.maxQueueSize - this.batch.length));
      }
    }
  }

  /**
   * Start auto-flush timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(
      () => this.flush(),
      BATCH_LOGGER_CONFIG.flushIntervalMs
    );

    // Cleanup on process exit
    if (typeof process !== "undefined") {
      process.on("beforeExit", () => this.flush());
    }
  }

  /**
   * Get current batch size (for monitoring)
   */
  getBatchSize(): number {
    return this.batch.length;
  }

  /**
   * Force immediate flush (for testing or shutdown)
   */
  async forceFlush(): Promise<void> {
    await this.flush();
  }
}

// Singleton instance
export const batchLogger = new BatchLogger();

/**
 * Logging interceptor
 * Captures request/response data and logs to batch
 */
export function createLoggingInterceptor(): Interceptor {
  return {
    onResponse: async (response, config, startTime) => {
      if (config.skipLogging) return response;

      const responseTimeMs = Date.now() - startTime;

      await batchLogger.log({
        api_name: config.apiName,
        endpoint: config.endpoint,
        request_params: config.metadata,
        response_status: response.status,
        response_time_ms: responseTimeMs,
        cache_hit: false,
        cost_usd: config.costOverride ?? 0,
        user_id: config.userId,
      });

      return response;
    },

    onError: async (error, config, startTime) => {
      if (config.skipLogging) return error;

      const responseTimeMs = Date.now() - startTime;

      await batchLogger.log({
        api_name: config.apiName,
        endpoint: config.endpoint,
        request_params: config.metadata,
        response_status: 0,
        response_time_ms: responseTimeMs,
        cache_hit: false,
        cost_usd: 0, // No cost for failed requests
        user_id: config.userId,
        error_message: error.message,
      });

      return error;
    },
  };
}

/**
 * Log a cache hit (separate from interceptor flow)
 */
export async function logCacheHit(config: ApiRequestConfig): Promise<void> {
  await batchLogger.log({
    api_name: config.apiName,
    endpoint: config.endpoint,
    request_params: config.metadata,
    response_status: 200,
    response_time_ms: 0,
    cache_hit: true,
    cost_usd: 0, // No cost for cache hits
    user_id: config.userId,
  });
}
