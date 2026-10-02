/**
 * With Redis configured, a check is one script call that counts and starts
 * the window together; if Redis fails, the in-memory limiter answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const evalMock = vi.fn();
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = evalMock;
  },
}));

const request = { headers: new Headers({ "x-forwarded-for": "203.0.113.7" }) } as unknown as NextRequest;

async function limiter(limit: number, windowMs: number) {
  vi.resetModules();
  const { createRateLimiter } = await import("./rate-limit");
  return createRateLimiter("test-ns", limit, windowMs);
}

beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test.local");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  evalMock.mockReset();
});

describe("createRateLimiter with Redis", () => {
  it("counts and starts the window in one script call", async () => {
    evalMock.mockResolvedValue(1);
    const check = await (await limiter(3, 60_000)).check(request);

    expect(evalMock).toHaveBeenCalledTimes(1);
    const [script, keys, args] = evalMock.mock.calls[0];
    expect(script).toContain('"INCR"');
    expect(script).toContain('"PEXPIRE"');
    expect(keys).toEqual(["ratelimit:test-ns:203.0.113.7"]);
    // ARGV[1] is the window in ms, ARGV[2] the limit.
    expect(args).toEqual(["60000", "3"]);
    expect(check).toEqual({ allowed: true, remaining: 2 });
  });

  it("blocks once the count passes the limit", async () => {
    evalMock.mockResolvedValue(4);
    expect(await (await limiter(3, 60_000)).check(request, "user-1")).toEqual({ allowed: false, remaining: 0 });
    expect(evalMock.mock.calls[0][1]).toEqual(["ratelimit:test-ns:user-1"]);
  });

  it("falls back to the in-memory limiter when Redis fails", async () => {
    evalMock.mockRejectedValue(new Error("network"));
    expect(await (await limiter(3, 60_000)).check(request)).toEqual({ allowed: true, remaining: 2 });
  });
});
