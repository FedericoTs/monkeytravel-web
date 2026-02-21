import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitRecord>>();

/**
 * Simple in-memory rate limiter for API routes.
 * Each `namespace` gets its own independent store.
 *
 * @param namespace - Unique name for the rate limit bucket (e.g. "subscribe")
 * @param limit - Max requests per window
 * @param windowMs - Time window in milliseconds (default: 60s)
 */
export function createRateLimiter(
  namespace: string,
  limit: number,
  windowMs = 60_000
) {
  if (!stores.has(namespace)) {
    stores.set(namespace, new Map());
  }
  const store = stores.get(namespace)!;

  return {
    check(request: NextRequest): { allowed: boolean; remaining: number } {
      const ip = getClientIP(request);
      const now = Date.now();
      const record = store.get(ip);

      if (!record || now > record.resetAt) {
        store.set(ip, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }

      if (record.count >= limit) {
        return { allowed: false, remaining: 0 };
      }

      record.count++;
      return { allowed: true, remaining: limit - record.count };
    },
  };
}

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
