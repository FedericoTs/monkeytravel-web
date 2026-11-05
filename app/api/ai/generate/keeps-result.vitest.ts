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
vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: async () => {},
  refundAnonymousGeneration: async () => {},
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
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => null }));
let multiCity: () => Promise<unknown>;
vi.mock("@/lib/ai/multi-city", () => ({
  validateLegs: () => {},
  generateMultiCityItinerary: () => multiCity(),
}));

const { POST } = await import("./route");
const { findGeneration } = await import("@/lib/ai/generation-result");
const { MODEL_OUTAGE_MESSAGE } = await import("@/lib/ai/model-outage");
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

const post = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
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
        ...extra,
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

  it("of a diet plan made no Places search: its places to eat are looked up once the trip is kept", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        requested.push(url instanceof Request ? url.url : String(url));
        return new Response("{}", { status: 500 });
      })
    );
    multiCity = async () => ({
      ...structuredClone(itinerary),
      days: itinerary.days.map((day) => ({ ...day, activities: [{ name: "Dinner at Krua Apsorn", type: "restaurant", description: "", location: "Bangkok" }] })),
    });
    try {
      expect((await post({}, { dietary: ["vegan"] })).status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(requested.filter((url) => url.includes("places.googleapis.com"))).toEqual([]);
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

  it("because the model's credit ran out says the planner is unavailable, not to try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    multiCity = async () => {
      throw new Error(`Failed to generate itinerary: AI service unavailable (root: {"error":{"code":402,"message":"Your prepayment credits are depleted."}})`);
    };
    const res = await post({});
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MODEL_OUTAGE_MESSAGE);
    expect(logged.find((row) => row.status === 500)?.error).toContain("prepayment credits");
  });

  it("for any other reason answers as before, and tells nothing of the model", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    multiCity = async () => {
      throw new Error("model overloaded");
    };
    const res = await post({});
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to generate itinerary. Please try again.");
  });
});
