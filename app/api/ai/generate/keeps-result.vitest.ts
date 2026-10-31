// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A finished plan is kept under the request's generation id before the answer
 * goes out, so a phone that dropped the request while it waited collects the
 * same plan (GET /api/ai/generate/result) instead of paying for another one.
 * Multi-city trips take this route only, so they are the case tested here.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (row: Record<string, unknown>) => void logged.push(row),
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 10, limit: 10 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/cache", () => ({
  getCachedItinerary: async () => null,
  cacheItinerary: async () => {},
  adjustItineraryDates: (itinerary: unknown) => itinerary,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => {} }));
vi.mock("@/lib/activity-bank", () => ({ isActivityBankPopulated: async () => true, populateActivityBank: async () => ({}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/maps-grounding", () => ({
  canGroundDestination: () => false,
  generateItineraryWithMapsGrounding: async () => {
    throw new Error("not used");
  },
  isMapsGroundingAvailable: () => false,
  getMapsGroundingCost: () => 0,
}));
vi.mock("@/lib/gemini", () => ({ validateTripParams: () => ({ valid: true }), generateItinerary: async () => null }));
let multiCity: () => Promise<unknown>;
vi.mock("@/lib/ai/multi-city", () => ({
  validateLegs: () => {},
  generateMultiCityItinerary: () => multiCity(),
}));

const { POST } = await import("./route");
const { findGeneration } = await import("@/lib/ai/generation-result");
const { GENERATION_ID_HEADER, newGenerationId } = await import("@/lib/ai/generation-id");

const itinerary = {
  destination: { name: "Phuket & Bangkok", country: "Thailand" },
  days: [1, 2].map((n) => ({
    day_number: n,
    date: `2026-11-0${n}`,
    title: `Day ${n}`,
    activities: [{ name: `Sight ${n}`, type: "attraction", description: "", location: n === 1 ? "Phuket" : "Bangkok" }],
  })),
};

const post = (headers: Record<string, string>) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mt_session_id=s1", ...headers },
      body: JSON.stringify({
        destination: "Phuket & Bangkok",
        startDate: "2026-11-01",
        endDate: "2026-11-02",
        destinations: [
          { city: "Phuket", nights: 1 },
          { city: "Bangkok", nights: 1 },
        ],
        vibes: ["foodie"],
      }),
    })
  );

beforeEach(() => {
  logged.length = 0;
  multiCity = async () => structuredClone(itinerary);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a finished generation", () => {
  it("is kept under the request's generation id, as it was answered", async () => {
    const id = newGenerationId();
    const res = await post({ [GENERATION_ID_HEADER]: id });
    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(await findGeneration(id, "s1")).toEqual({ itinerary: answer.itinerary, meta: answer.meta });
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({ generation_id: id });
  });

  it("is not kept for a request without an id", async () => {
    expect((await post({})).status).toBe(200);
    expect(logged.find((row) => row.status === 200)?.metadata).not.toHaveProperty("generation_id");
  });

  it("that failed is logged with its generation id, and nothing is kept", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    multiCity = async () => {
      throw new Error("model overloaded");
    };
    const id = newGenerationId();
    expect((await post({ [GENERATION_ID_HEADER]: id })).status).toBe(500);
    expect(logged.find((row) => row.status === 500)?.metadata).toEqual({ generation_id: id });
    expect(await findGeneration(id, "s1")).toBeNull();
  });
});
