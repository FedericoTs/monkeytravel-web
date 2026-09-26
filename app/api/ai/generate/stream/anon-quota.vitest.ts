// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The wizard's anonymous generations count against the 5-a-day cap.
 *
 * The streaming route recorded an anonymous generation after the stream
 * ended, by setting the mt_anon cookie through cookies(). By then the
 * response headers were long sent, so the cookie never reached the browser
 * and the cap (and the "sign up to keep generating" ask it drives) never
 * applied to the wizard. Verified on production 2026-09-25: a fresh 14-day
 * generation left no mt_anon cookie. It is now recorded before the stream
 * starts. These tests call the route WITHOUT reading the stream: anything
 * recorded by then was recorded while the headers could still carry it.
 */

const recordAnonymousGeneration = vi.fn(async () => {});
let user: { id: string; email: string } | null = null;
let cached: { days: unknown[] } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: () => recordAnonymousGeneration(),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}),
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: undefined, userLanguage: "en" }),
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async () => {},
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 10, limit: 10 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/cache", () => ({
  getCachedItinerary: async () => cached,
  cacheItinerary: async () => {},
  adjustItineraryDates: (itinerary: unknown) => itinerary,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/gemini", () => ({
  validateTripParams: () => ({ valid: true }),
  generateItineraryStream: () => {
    throw new Error("the stream is never read in these tests");
  },
  parseStreamedItinerary: () => null,
}));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => [] }));

import { POST } from "./route";

// 2026-11-01 → 2026-11-03: a 3-day trip.
function request(extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/ai/generate/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      destination: "Gori, Georgia",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      vibes: ["foodie"],
      ...extra,
    }),
  });
}

async function call(extra?: Record<string, unknown>) {
  const res = await POST(request(extra));
  await res.body?.cancel().catch(() => {});
  return res;
}

beforeEach(() => {
  recordAnonymousGeneration.mockClear();
  user = null;
  cached = null;
});

describe("anonymous quota on the streaming route", () => {
  it("a real generation is counted before the stream starts", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(recordAnonymousGeneration).toHaveBeenCalledTimes(1);
  });

  it("a cache hit stays free", async () => {
    cached = { days: [{}, {}, {}, {}] }; // 4 days answers a 3-day trip
    await call();
    expect(recordAnonymousGeneration).not.toHaveBeenCalled();
  });

  it("a cached entry too short to answer is a real generation, so it counts", async () => {
    cached = { days: [{}, {}] }; // 2 days can't answer a 3-day trip
    await call();
    expect(recordAnonymousGeneration).toHaveBeenCalledTimes(1);
  });

  it("a personalized request bypasses the cache, so it counts", async () => {
    cached = { days: [{}, {}, {}, {}] };
    await call({ mustDos: ["Stalin Museum"] });
    expect(recordAnonymousGeneration).toHaveBeenCalledTimes(1);
  });

  it("a signed-in user is not on the anonymous counter", async () => {
    user = { id: "user-1", email: "someone@test.local" };
    await call();
    expect(recordAnonymousGeneration).not.toHaveBeenCalled();
  });
});
