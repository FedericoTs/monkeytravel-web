/**
 * API Control Module
 *
 * Provides centralized control over external API access.
 * Admins can enable/disable APIs, block calls, or put them in maintenance mode.
 *
 * Usage:
 * ```typescript
 * import { checkApiAccess, logApiCall, ApiBlockedError } from '@/lib/api-gateway/api-control';
 *
 * // Before making API call
 * const access = await checkApiAccess('google_places_search');
 * if (!access.allowed) {
 *   throw new ApiBlockedError(access.apiName, access.message);
 * }
 *
 * // After API call (success or failure)
 * await logApiCall({
 *   apiName: 'google_places_search',
 *   endpoint: '/places:searchText',
 *   status: 200,
 *   responseTimeMs: 150,
 *   cacheHit: false,
 *   costUsd: 0.032,
 *   error: null,
 * });
 * ```
 */

import { createClient } from "@/lib/supabase/server";

// In-memory cache for API config (5 second TTL to reduce DB calls)
let configCache: Map<string, ApiConfigEntry> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000;

export interface ApiConfigEntry {
  apiName: string;
  displayName: string;
  enabled: boolean;
  blockMode: "none" | "block_calls" | "block_keys" | "maintenance";
  category: string;
  costPerRequest: number;
}

export interface ApiAccessResult {
  allowed: boolean;
  apiName: string;
  blockMode: string;
  message: string | null;
  shouldPassKey: boolean;
}

export interface LogApiCallParams {
  apiName: string;
  endpoint: string;
  status: number;
  responseTimeMs: number;
  cacheHit: boolean;
  costUsd: number;
  error?: string | null;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Error thrown when an API is blocked
 */
export class ApiBlockedError extends Error {
  public readonly apiName: string;
  public readonly blockMode: string;

  constructor(apiName: string, message: string, blockMode: string = "block_calls") {
    super(message);
    this.name = "ApiBlockedError";
    this.apiName = apiName;
    this.blockMode = blockMode;
  }
}

/**
 * Load all API configurations from database
 */
async function loadApiConfigs(): Promise<void> {
  const now = Date.now();

  // Return cached if still valid
  if (configCache.size > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("api_config")
      .select("api_name, display_name, enabled, block_mode, category, cost_per_request");

    if (error) {
      console.error("[ApiControl] Failed to load config:", error);
      return;
    }

    // Update cache
    configCache = new Map();
    for (const row of data || []) {
      configCache.set(row.api_name, {
        apiName: row.api_name,
        displayName: row.display_name,
        enabled: row.enabled,
        blockMode: row.block_mode,
        category: row.category,
        costPerRequest: Number(row.cost_per_request) || 0,
      });
    }
    cacheTimestamp = now;
  } catch (err) {
    console.error("[ApiControl] Error loading config:", err);
  }
}

/**
 * Check if an API is allowed to be called
 * Call this BEFORE making any external API request
 */
export async function checkApiAccess(apiName: string): Promise<ApiAccessResult> {
  await loadApiConfigs();

  const config = configCache.get(apiName);

  // Unknown API - allow by default (fail-open for new APIs)
  if (!config) {
    return {
      allowed: true,
      apiName,
      blockMode: "none",
      message: null,
      shouldPassKey: true,
    };
  }

  // API is disabled
  if (!config.enabled) {
    const message = config.blockMode === "maintenance"
      ? "This service is temporarily unavailable for maintenance"
      : `${config.displayName} has been disabled by the administrator`;

    return {
      allowed: false,
      apiName,
      blockMode: config.blockMode,
      message,
      shouldPassKey: false,
    };
  }

  // API is enabled but in block_keys mode (for testing)
  if (config.blockMode === "block_keys") {
    return {
      allowed: true,
      apiName,
      blockMode: config.blockMode,
      message: null,
      shouldPassKey: false, // Don't pass the real API key
    };
  }

  // API is fully enabled
  return {
    allowed: true,
    apiName,
    blockMode: "none",
    message: null,
    shouldPassKey: true,
  };
}

/**
 * Get the cost per request for an API
 */
export async function getApiCostFromConfig(apiName: string): Promise<number> {
  await loadApiConfigs();
  const config = configCache.get(apiName);
  return config?.costPerRequest ?? 0;
}

/**
 * Log an API call to the database
 * Call this AFTER every external API request (success or failure)
 */
export async function logApiCall(params: LogApiCallParams): Promise<void> {
  try {
    const supabase = await createClient();

    // Get cost from config if not provided
    const cost = params.costUsd > 0
      ? params.costUsd
      : await getApiCostFromConfig(params.apiName);

    const { error } = await supabase.from("api_request_logs").insert({
      api_name: params.apiName,
      endpoint: params.endpoint,
      response_status: params.status,
      response_time_ms: params.responseTimeMs,
      cache_hit: params.cacheHit,
      cost_usd: params.cacheHit ? 0 : cost,
      error_message: params.error || null,
      user_id: params.userId || null,
      request_params: params.metadata || null,
      timestamp: new Date().toISOString(),
    });

    if (error) {
      console.error("[ApiControl] Failed to log API call:", error);
    }
  } catch (err) {
    // Don't throw - logging should never break the main flow
    console.error("[ApiControl] Error logging API call:", err);
  }
}

/**
 * Log a blocked API call attempt
 */
export async function logBlockedCall(
  apiName: string,
  endpoint: string,
  reason: string
): Promise<void> {
  try {
    const supabase = await createClient();

    await supabase.from("api_request_logs").insert({
      api_name: apiName,
      endpoint: endpoint,
      response_status: 503, // Service Unavailable
      response_time_ms: 0,
      cache_hit: false,
      cost_usd: 0,
      error_message: `BLOCKED: ${reason}`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[ApiControl] Error logging blocked call:", err);
  }
}

/**
 * Get all API configurations (for admin dashboard)
 */
export async function getAllApiConfigs(): Promise<ApiConfigEntry[]> {
  await loadApiConfigs();
  return Array.from(configCache.values());
}

/**
 * Force refresh the config cache
 */
export function invalidateConfigCache(): void {
  configCache = new Map();
  cacheTimestamp = 0;
}

/**
 * Helper to wrap an API call with access check and logging
 */
export async function withApiControl<T>(
  apiName: string,
  endpoint: string,
  fn: (shouldPassKey: boolean) => Promise<T>,
  options?: { userId?: string; metadata?: Record<string, unknown> }
): Promise<T> {
  const startTime = Date.now();

  // Check access
  const access = await checkApiAccess(apiName);

  if (!access.allowed) {
    await logBlockedCall(apiName, endpoint, access.message || "API disabled");
    throw new ApiBlockedError(apiName, access.message || "API disabled", access.blockMode);
  }

  try {
    // Execute the API call
    const result = await fn(access.shouldPassKey);

    // Log success
    await logApiCall({
      apiName,
      endpoint,
      status: 200,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0, // Will be fetched from config
      userId: options?.userId,
      metadata: options?.metadata,
    });

    return result;
  } catch (error) {
    // Log failure
    await logApiCall({
      apiName,
      endpoint,
      status: 500,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0,
      error: error instanceof Error ? error.message : String(error),
      userId: options?.userId,
      metadata: options?.metadata,
    });

    throw error;
  }
}
