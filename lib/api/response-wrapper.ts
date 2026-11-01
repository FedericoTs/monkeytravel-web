/**
 * API Response Wrapper Utilities
 *
 * Consolidates common API response patterns across all routes:
 * - Consistent error formatting
 * - Status code mapping
 * - Success/error response structures
 * - Timing metadata
 *
 * Used by 57+ API routes to reduce duplicate try/catch patterns.
 */

import { NextResponse } from "next/server";

// ============================================================================
// Types
// ============================================================================

export interface ApiErrorOptions {
  /** HTTP status code */
  status?: number;
  /** Error code for programmatic handling */
  code?: string;
  /** Additional context (e.g., usage limits, upgrade URL) */
  context?: Record<string, unknown>;
  /** Log the error to console */
  log?: boolean;
  /** Error category for logging */
  category?: string;
}

export interface ApiSuccessOptions {
  /** HTTP status code (default: 200) */
  status?: number;
  /** Response metadata */
  meta?: Record<string, unknown>;
  /** Wrap response in { success: true, data: ... } format */
  wrap?: boolean;
  /** Custom response headers (e.g., Cache-Control) */
  headers?: Record<string, string>;
}

// ============================================================================
// Error Response Helpers
// ============================================================================

/**
 * Create a standardized error response
 *
 * @example
 * // Simple error
 * return apiError("Invalid email format", { status: 400 });
 *
 * @example
 * // Error with context
 * return apiError("Rate limit exceeded", {
 *   status: 429,
 *   code: "RATE_LIMIT",
 *   context: { usage: usageCheck, upgradeUrl: "/pricing" }
 * });
 */
export function apiError(
  message: string,
  options: ApiErrorOptions = {}
): NextResponse {
  const { status = 500, code, context, log = true, category } = options;

  if (log) {
    const prefix = category ? `[${category}]` : "[API]";
    // A 4xx describes the client's state (signed out, not found, over a
    // limit); only a 5xx is a failure of ours, so only that is an error.
    (status >= 500 ? console.error : console.warn)(`${prefix} Error (${status}):`, message);
  }

  const body: Record<string, unknown> = { error: message };

  if (code) {
    body.code = code;
  }

  if (context) {
    Object.assign(body, context);
  }

  return NextResponse.json(body, { status });
}

/**
 * Create common error responses with predefined status codes
 */
export const errors = {
  /** 400 Bad Request */
  badRequest: (message = "Bad request", context?: Record<string, unknown>) =>
    apiError(message, { status: 400, context }),

  /** 401 Unauthorized */
  unauthorized: (message = "Unauthorized") =>
    apiError(message, { status: 401 }),

  /** 403 Forbidden */
  forbidden: (message = "Access denied", code?: string) =>
    apiError(message, { status: 403, code }),

  /** 404 Not Found */
  notFound: (message = "Resource not found") =>
    apiError(message, { status: 404 }),

  /** 409 Conflict (duplicate resource) */
  conflict: (message = "Resource already exists") =>
    apiError(message, { status: 409 }),

  /** 410 Gone (resource expired or no longer available) */
  gone: (message = "Resource is no longer available", code?: string) =>
    apiError(message, { status: 410, code }),

  /** 429 Too Many Requests (rate limit) */
  rateLimit: (message = "Rate limit exceeded", context?: Record<string, unknown>) =>
    apiError(message, { status: 429, code: "RATE_LIMIT", context }),

  /** 500 Internal Server Error */
  internal: (message = "Internal server error", category?: string) =>
    apiError(message, { status: 500, category }),

  /** 503 Service Unavailable (API disabled) */
  serviceUnavailable: (message = "Service temporarily unavailable") =>
    apiError(message, { status: 503 }),
};

// ============================================================================
// Success Response Helpers
// ============================================================================

/**
 * Create a standardized success response
 *
 * @example
 * // Simple response
 * return apiSuccess({ users: [...] });
 *
 * @example
 * // With metadata
 * return apiSuccess(itinerary, {
 *   meta: { generationTimeMs: 1234, model: "gemini-2.5-flash" }
 * });
 *
 * @example
 * // Wrapped format
 * return apiSuccess(data, { wrap: true });
 * // Returns: { success: true, data: ... }
 */
export function apiSuccess<T>(
  data: T,
  options: ApiSuccessOptions = {}
): NextResponse {
  const { status = 200, meta, wrap = false, headers } = options;

  // Build response options with optional headers
  const responseOptions: { status: number; headers?: Record<string, string> } = { status };
  if (headers) {
    responseOptions.headers = headers;
  }

  if (wrap) {
    const body: Record<string, unknown> = { success: true, data };
    if (meta) {
      body.meta = meta;
    }
    return NextResponse.json(body, responseOptions);
  }

  if (meta) {
    // Merge meta into response at top level
    const body = typeof data === "object" && data !== null
      ? { ...data, meta }
      : { data, meta };
    return NextResponse.json(body, responseOptions);
  }

  return NextResponse.json(data, responseOptions);
}
