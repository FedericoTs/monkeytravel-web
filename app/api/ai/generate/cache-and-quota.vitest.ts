// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Both generation routes read the planner's monthly quota and the shared plan
 * cache before writing anything: over the quota is a 429 before any model
 * call, and a cached plan long enough for the trip is served without one,
 * unless the trip is tailored to the traveller.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "planner@example.com" } } }) },
  }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) }));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: async () => {},
  refundAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
let quota: Record<string, unknown>;
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: async () => quota, incrementUsage: async () => {} }));
let cached: unknown = null;
vi.mock("@/lib/ai/cache", () => ({
  getCachedItinerary: async () => cached,
  cacheItinerary: async () => {},
  adjustItineraryDates: (itinerary: unknown) => itinerary,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
const modelCalls = vi.fn();
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async () => {
    modelCalls();
    return structuredClone(plan("Written"));
  },
  generateItineraryStream: () => {
    modelCalls();
    throw new Error("the stream is never read in these tests");
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: () => null }));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => [] }));
vi.mock("@/lib/activity-bank", () => ({ isActivityBankPopulated: async () => true, populateActivityBank: async () => ({}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));
vi.mock("@/lib/maps-grounding", () => ({
  canGroundDestination: () => false,
  generateItineraryWithMapsGrounding: async () => {
    throw new Error("not used");
  },
  isMapsGroundingAvailable: () => false,
  getMapsGroundingCost: () => 0,
}));

const { POST: postJson } = await import("./route");
const { POST: postStream } = await import("./stream/route");

function plan(title: string) {
  return {
    destination: { name: "Lisbon", country: "Portugal" },
    days: [1, 2, 3].map((n) => ({
      day_number: n,
      date: `2026-11-0${n}`,
      title: `${title} day ${n}`,
      activities: [{ name: `${title} sight ${n}`, type: "attraction", description: "", location: "Lisbon" }],
    })),
  };
}

function request(path: string, extra: Record<string, unknown> = {}) {
  return new NextRequest(`https://monkeytravel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "mt_session_id=s1" },
    body: JSON.stringify({
      destination: "Lisbon, Portugal",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      vibes: ["foodie"],
      ...extra,
    }),
  });
}

const OVER = { allowed: false, used: 3, remaining: 0, limit: 3, message: "You have used this month's 3 trips." };
const UNDER = { allowed: true, used: 1, remaining: 2, limit: 3 };

beforeEach(() => {
  quota = UNDER;
  cached = null;
  modelCalls.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("over the monthly quota", () => {
  it.each([
    ["JSON", postJson, "/api/ai/generate"],
    ["streaming", postStream, "/api/ai/generate/stream"],
  ] as const)("the %s route answers 429 before any model call", async (_, post, path) => {
    quota = OVER;
    const res = await post(request(path));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: OVER.message, code: "RATE_LIMIT", usage: OVER, upgradeUrl: "/pricing" });
    expect(modelCalls).not.toHaveBeenCalled();
  });
});

describe("the shared plan cache (JSON route)", () => {
  it("serves a cached plan long enough for the trip without a model call", async () => {
    cached = plan("Cached");
    const res = await postJson(request("/api/ai/generate"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("Cached day 3");
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("writes a new plan for a trip with must-dos", async () => {
    cached = plan("Cached");
    const res = await postJson(request("/api/ai/generate", { mustDos: ["Belém Tower"] }));
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("Written day 3");
    expect(body).not.toContain("Cached day 3");
    expect(modelCalls).toHaveBeenCalledTimes(1);
  });
});
