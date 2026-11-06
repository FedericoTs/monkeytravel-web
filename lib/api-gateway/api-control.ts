/**
 * API Control Module
 *
 * Provides centralized control over external API access.
 * Admins can enable/disable APIs, block calls, or put them in maintenance mode.
 * An API with a daily_limit also stops for the rest of the UTC day once it's
 * used up, so a runaway can't spend without end before anyone reads the alert.
 *
 * Usage:
 * ```typescript
 * import { blockedCall, checkApiAccess, logApiCall } from '@/lib/api-gateway/api-control';
 *
 * // Before making API call
 * const access = await checkApiAccess('google_places_search');
 * if (!access.allowed) {
 *   return blockedCall(access, { apiName: 'google_places_search', endpoint: '/places:searchText', startTime, disabled: 'Places search is currently disabled' });
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

import { errors } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * Service-role client for api_request_logs.
 *
 * This table is pure server telemetry: user_id is set explicitly on the row,
 * never derived from the caller session, so it does not need — and should not
 * depend on — a user-scoped client. It used the cookie client, which resolves
 * to the anon role for anonymous traffic, and that is the only reason anon
 * needed INSERT on the table. Moving the writes here lets that grant be
 * revoked without blinding anonymous API logging.
 *
 * Returns null rather than throwing when the service key is absent: dropping a
 * telemetry row is warn-level, exactly as the surrounding code already treats
 * a failed insert.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

let logDb: ReturnType<typeof createAdminClient> | null | undefined;
function apiLogDb() {
  if (logDb !== undefined) return logDb;
  try { logDb = createAdminClient(); }
  catch { console.warn("[ApiControl] no service role — API-call logging disabled"); logDb = null; }
  return logDb;
}

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
  dailyLimit?: number | null;
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
  /**
   * costUsd was measured (Gemini tokens, a priced Google call), so log it as
   * is, even at 0. Without this a 0 means "look up api_config's flat
   * cost_per_request", which books $0.003 for a Gemini call that never ran.
   */
  exactCost?: boolean;
  error?: string | null;
  userId?: string;
  metadata?: Record<string, unknown>;
}

const configReads = new Map<string, Promise<ApiConfigEntry | null>>();

/**
 * Fetch API configuration for a specific API from database
 * Always fetches fresh data for reliable access control. Only calls made while
 * a read is running share it: a trip's lookups start together.
 */
function fetchApiConfig(apiName: string): Promise<ApiConfigEntry | null> {
  const running = configReads.get(apiName);
  if (running) return running;
  const read = readApiConfig(apiName).finally(() => configReads.delete(apiName));
  configReads.set(apiName, read);
  return read;
}

async function readApiConfig(apiName: string): Promise<ApiConfigEntry | null> {
  try {
    // The service role: this also runs after a response, with no cookies to read.
    const supabase = apiLogDb();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("api_config")
      .select("api_name, display_name, enabled, block_mode, category, cost_per_request, daily_limit")
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
      dailyLimit: data.daily_limit,
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

  // Past today's limit
  if (config.dailyLimit !== null && config.dailyLimit !== undefined) {
    const today = new Date().toISOString().slice(0, 10);
    const { allowed } = await createRateLimiter(`daily-${apiName}`, config.dailyLimit, DAY_MS).checkKey(today);
    if (!allowed) {
      console.error(`[ApiControl] ${apiName} is past its daily limit of ${config.dailyLimit}`);
      return {
        allowed: false,
        apiName,
        blockMode: "daily_limit",
        message: `${config.displayName} has reached today's limit. Please try again tomorrow.`,
        shouldPassKey: false,
      };
    }
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
 * The api_request_logs row for one call. A cache hit is booked at $0 whatever
 * its cost says, so it never needs api_config.
 */
async function logRow(params: LogApiCallParams, configCost: (apiName: string) => Promise<number>) {
  // Get cost from config if not provided
  const cost = params.cacheHit
    ? 0
    : params.exactCost || params.costUsd > 0
      ? params.costUsd
      : await configCost(params.apiName);

  return {
    api_name: params.apiName,
    endpoint: params.endpoint,
    response_status: params.status,
    response_time_ms: params.responseTimeMs,
    cache_hit: params.cacheHit,
    cost_usd: cost,
    error_message: params.error || null,
    user_id: params.userId || null,
    request_params: params.metadata || null,
    timestamp: new Date().toISOString(),
  };
}

type LogRow = Awaited<ReturnType<typeof logRow>>;

async function insertLogRows(
  supabase: NonNullable<ReturnType<typeof apiLogDb>>,
  rows: LogRow | LogRow[]
): Promise<void> {
  // A dropped connection (a keep-alive socket gone stale while the function
  // idled) gets no HTTP response. supabase-js usually returns that as an error
  // with status 0 rather than throwing, so both shapes get one retry.
  const insert = async (): Promise<{ error: unknown; status: number }> => {
    try {
      const { error, status } = await supabase.from("api_request_logs").insert(rows);
      return { error, status };
    } catch (thrown) {
      return { error: thrown, status: 0 };
    }
  };

  let { error, status } = await insert();
  if (error && status === 0) {
    await new Promise((r) => setTimeout(r, 300));
    ({ error, status } = await insert());
    if (error && status === 0) {
      console.warn("[ApiControl] API-call log dropped after retry:", error);
      return;
    }
  }

  if (error) {
    console.error("[ApiControl] Failed to log API call:", error);
  }
}

/**
 * Log an API call to the database
 * Call this AFTER every external API request (success or failure)
 */
export async function logApiCall(params: LogApiCallParams): Promise<void> {
  try {
    const supabase = apiLogDb();
    if (!supabase) return;
    await insertLogRows(supabase, await logRow(params, getApiCostFromConfig));
  } catch (err) {
    // Don't throw - logging should never break the main flow
    console.warn("[ApiControl] Error logging API call:", err);
  }
}

/**
 * Log several API calls in one insert: the rows logApiCall would write, in one
 * round trip, reading api_config at most once per API.
 */
export async function logApiCalls(calls: LogApiCallParams[]): Promise<void> {
  if (calls.length === 0) return;
  try {
    const supabase = apiLogDb();
    if (!supabase) return;
    const costs = new Map<string, Promise<number>>();
    const configCost = (apiName: string) => {
      const cost = costs.get(apiName) ?? getApiCostFromConfig(apiName);
      costs.set(apiName, cost);
      return cost;
    };
    await insertLogRows(supabase, await Promise.all(calls.map((call) => logRow(call, configCost))));
  } catch (err) {
    console.warn("[ApiControl] Error logging API calls:", err);
  }
}

/**
 * The answer to a call its API's kill-switch has turned off: logged as a
 * blocked call (a 503 at no cost, since nothing ran) and a 503 carrying the
 * switch's message, or `disabled` when it has none.
 */
export async function blockedCall(
  access: ApiAccessResult,
  call: { apiName: string; endpoint: string; startTime: number; disabled: string; metadata?: Record<string, unknown> }
): Promise<Response> {
  await logApiCall({
    apiName: call.apiName,
    endpoint: call.endpoint,
    status: 503,
    responseTimeMs: Date.now() - call.startTime,
    cacheHit: false,
    costUsd: 0,
    exactCost: true,
    error: `BLOCKED: ${access.message}`,
    metadata: call.metadata,
  });
  return errors.serviceUnavailable(access.message || call.disabled);
}

/**
 * Get all API configurations (for admin dashboard)
 */
export async function getAllApiConfigs(): Promise<ApiConfigEntry[]> {
  return fetchAllApiConfigs();
}

