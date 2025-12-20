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

export interface ApiSuccessOptions<T> {
  /** HTTP status code (default: 200) */
  status?: number;
  /** Response metadata */
  meta?: Record<string, unknown>;
  /** Wrap response in { success: true, data: ... } format */
  wrap?: boolean;
}

export interface TimingContext {
  startTime: number;
  endpoint?: string;
  category?: string;
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
    console.error(`${prefix} Error (${status}):`, message);
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
  options: ApiSuccessOptions<T> = {}
): NextResponse {
  const { status = 200, meta, wrap = false } = options;

  if (wrap) {
    const body: Record<string, unknown> = { success: true, data };
    if (meta) {
      body.meta = meta;
    }
    return NextResponse.json(body, { status });
  }

  if (meta) {
    // Merge meta into response at top level
    const body = typeof data === "object" && data !== null
      ? { ...data, meta }
      : { data, meta };
    return NextResponse.json(body, { status });
  }

  return NextResponse.json(data, { status });
}

// ============================================================================
// Request Timing
// ============================================================================

/**
 * Create a timing context to track request duration
 *
 * @example
 * export async function POST(req: Request) {
 *   const timing = startTiming("/api/places");
 *   // ... do work ...
 *   console.log(`Request took ${timing.elapsed()}ms`);
 * }
 */
export function startTiming(endpoint?: string, category?: string): {
  startTime: number;
  elapsed: () => number;
  context: TimingContext;
} {
  const startTime = Date.now();
  return {
    startTime,
    elapsed: () => Date.now() - startTime,
    context: { startTime, endpoint, category },
  };
}

// ============================================================================
// Error Status Code Mapping
// ============================================================================

/**
 * Map error messages to appropriate HTTP status codes
 * Used when catching external API errors
 *
 * @example
 * catch (error) {
 *   const status = getErrorStatus(error.message);
 *   return apiError("Request failed", { status });
 * }
 */
export function getErrorStatus(errorMessage: string): number {
  const message = errorMessage.toLowerCase();

  if (message.includes("rate limit") || message.includes("quota")) {
    return 429;
  }
  if (message.includes("authentication") || message.includes("unauthorized") || message.includes("api key")) {
    return 401;
  }
  if (message.includes("forbidden") || message.includes("access denied")) {
    return 403;
  }
  if (message.includes("not found")) {
    return 404;
  }
  if (message.includes("bad request") || message.includes("invalid") || message.includes("request error")) {
    return 400;
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return 504;
  }
  if (message.includes("unavailable") || message.includes("service")) {
    return 503;
  }

  return 500;
}

// ============================================================================
// Handler Wrapper
// ============================================================================

type ApiHandler = (req: Request) => Promise<NextResponse>;

/**
 * Wrap an API handler with consistent error handling
 *
 * @example
 * export const POST = wrapApiHandler(async (req) => {
 *   const body = await req.json();
 *   const result = await doSomething(body);
 *   return apiSuccess(result);
 * }, { category: "Places" });
 */
export function wrapApiHandler(
  handler: ApiHandler,
  options: { category?: string } = {}
): ApiHandler {
  const { category = "API" } = options;

  return async (req: Request) => {
    const timing = startTiming(req.url, category);

    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = getErrorStatus(message);

      console.error(`[${category}] Error after ${timing.elapsed()}ms:`, error);

      return apiError("An unexpected error occurred", {
        status,
        category,
        context: { responseTimeMs: timing.elapsed() },
      });
    }
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate required fields and return error response if missing
 *
 * @example
 * const validation = validateRequired({ email, password }, ["email", "password"]);
 * if (validation) return validation;
 */
export function validateRequired(
  data: Record<string, unknown>,
  fields: string[]
): NextResponse | null {
  const missing = fields.filter((field) => !data[field]);

  if (missing.length > 0) {
    return apiError(`Missing required fields: ${missing.join(", ")}`, {
      status: 400,
      context: { required: fields, received: Object.keys(data) },
    });
  }

  return null;
}
