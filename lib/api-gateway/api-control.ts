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

/**
 * IMPORTANT: No in-memory caching for API config
 *
 * In Vercel's serverless environment, each request may hit a different
 * function instance. In-memory caching would cause stale reads when an
 * admin toggles an API off - other instances would continue serving the
 * old (enabled) state until their cache expires.
 *
 * For reliable API control, we ALWAYS fetch fresh config from the database.
 * The minor latency (~5-10ms) is worth the reliability.
 */

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
 * Fetch API configuration for a specific API from database
 * Always fetches fresh data for reliable access control
 */
async function fetchApiConfig(apiName: string): Promise<ApiConfigEntry | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("api_config")
      .select("api_name, display_name, enabled, block_mode, category, cost_per_request")
      .eq("api_name", apiName)
      .single();

    if (error || !data) {
      // Not found - API may not be configured yet
      return null;
    }

    return {
      apiName: data.api_name,
      displayName: data.display_name,
      enabled: data.enabled,
      blockMode: data.block_mode,
      category: data.category,
      costPerRequest: Number(data.cost_per_request) || 0,
    };
  } catch (err) {
    console.error("[ApiControl] Error fetching config for", apiName, ":", err);
    return null;
  }
}

/**
 * Fetch all API configurations from database (for admin dashboard)
 */
async function fetchAllApiConfigs(): Promise<ApiConfigEntry[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("api_config")
      .select("api_name, display_name, enabled, block_mode, category, cost_per_request");

    if (error) {
      console.error("[ApiControl] Failed to load all configs:", error);
      return [];
    }

    return (data || []).map((row) => ({
      apiName: row.api_name,
      displayName: row.display_name,
      enabled: row.enabled,
      blockMode: row.block_mode,
      category: row.category,
      costPerRequest: Number(row.cost_per_request) || 0,
    }));
  } catch (err) {
    console.error("[ApiControl] Error loading all configs:", err);
    return [];
  }
}

/**
 * Check if an API is allowed to be called
 * Call this BEFORE making any external API request
 *
 * IMPORTANT: Always fetches fresh from database - no caching
 * This ensures admin toggle changes take effect immediately
 */
export async function checkApiAccess(apiName: string): Promise<ApiAccessResult> {
  const config = await fetchApiConfig(apiName);

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
  const config = await fetchApiConfig(apiName);
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
  return fetchAllApiConfigs();
}

/**
 * Force refresh the config cache
 * @deprecated No longer needed - we always fetch fresh from database
 * Kept for backwards compatibility with existing callers
 */
export function invalidateConfigCache(): void {
  // No-op: cache has been removed for reliability
  // This function is kept for backwards compatibility
  console.log("[ApiControl] invalidateConfigCache called (no-op - caching removed)");
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
