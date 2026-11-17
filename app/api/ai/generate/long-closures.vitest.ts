// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route, a multi-city plan included, takes out a stop at a place shut
 * for the whole trip, as the stream does.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
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
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));

// Thursday 24 to Saturday 26 December 2026, the Centre Pompidou on day 2.
const plan = () => ({
  destination: { name: "Paris", country: "France" },
  days: [["Louvre Museum", "museum"], ["Centre Pompidou", "museum"], ["Musée d'Orsay", "museum"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: `2026-12-${24 + i}`,
    theme: name,
    activities: [
      { name, type, description: "", location: "Paris" },
      { name: `Lunch ${i + 1}`, type: "restaurant", description: "", location: "Paris" },
    ],
  })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async () => ({
        response: { text: () => JSON.stringify({ places: [] }), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } },
      }),
    }),
  },
}));

const { POST } = await import("./route");

const stops = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Paris, France", startDate: "2026-12-24", endDate: "2026-12-26", vibes: ["cultural"], ...extra }),
    })
  );
  expect(res.status).toBe(200);
  return ((await res.json()).itinerary.days as Array<{ activities: Array<{ name: string }> }>).map((d) =>
    d.activities.map((a) => a.name).join(" + ")
  );
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route", () => {
  it("takes the Centre Pompidou out of a Paris plan while it is shut", async () => {
    expect(await stops()).toEqual(["Louvre Museum + Lunch 1", "Lunch 2", "Musée d'Orsay + Lunch 3"]);
  });

  it("and out of a trip through Paris and another city", async () => {
    const legs = { destination: "Paris & Lyon", destinations: [{ city: "Paris", nights: 2 }, { city: "Lyon", nights: 1 }] };
    expect((await stops(legs)).join(" | ")).not.toContain("Pompidou");
  });
});
