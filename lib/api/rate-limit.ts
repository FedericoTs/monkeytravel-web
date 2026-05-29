import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitRecord>>();

// Detect Upstash KV at module load. Both env vars must be present on Vercel:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// These are NOT committed (not in .env.example) — set them in the Vercel
// project settings. Without them the limiter still works locally and in CI,
// but on Vercel each function instance gets its own Map, so burst protection
// across instances is best-effort only.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
if (UPSTASH_URL && UPSTASH_TOKEN) {
  try {
    redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
  } catch (err) {
    // Construction shouldn't fail with valid env, but if it does we degrade.
    console.warn(
      "[rate-limit] Failed to construct Upstash Redis client, falling back to in-memory",
      err
    );
    redis = null;
  }
} else {
  // Log once at module load so the warning shows up in cold-start logs but
  // doesn't spam every request.
  console.warn(
    "[rate-limit] KV not configured, using in-memory fallback (won't work across Vercel function instances)"
  );
}

/**
 * Distributed rate limiter for API routes, backed by Upstash Redis when
 * configured, with a per-instance in-memory fallback.
 *
 * Each `namespace` gets its own bucket. On Vercel the in-memory store
 * does not span function invocations — set UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN in your Vercel project to get shared state.
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
    async check(
      request: NextRequest
    ): Promise<{ allowed: boolean; remaining: number }> {
      const ip = getClientIP(request);

      if (redis) {
        try {
          return await checkRedis(redis, namespace, ip, limit, windowMs);
        } catch (err) {
          // Network/KV error — degrade to in-memory rather than failing open
          // or open-503ing the consumer. The fallback at least limits within
          // this function instance for the duration of the outage.
          console.warn(
            `[rate-limit] KV check failed for ns=${namespace}, falling back to in-memory`,
            err
          );
        }
      }

      return checkMemory(store, ip, limit, windowMs);
    },
  };
}

async function checkRedis(
  client: Redis,
  namespace: string,
  ip: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `ratelimit:${namespace}:${ip}`;
  const count = await client.incr(key);

  // First hit in the window — set the TTL. We use EXPIRE rather than
  // SET+EX so we don't race with a sibling increment that's already past
  // the first hit.
  if (count === 1) {
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    await client.expire(key, ttlSeconds);
  }

  if (count > limit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: limit - count };
}

function checkMemory(
  store: Map<string, RateLimitRecord>,
  ip: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number } {
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
}

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
