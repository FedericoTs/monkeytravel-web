// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route orders a one-city plan's days around its sights' closing
 * days, as the stream does. A multi-city plan keeps its order: its days follow
 * the route from city to city.
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
vi.mock("@/lib/activity-bank", () => ({ isActivityBankPopulated: async () => true, populateActivityBank: async () => ({}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));

// Saturday 28 to Monday 30 November, the museum on the Monday.
const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: [["Real Alcázar", "attraction"], ["Plaza de España", "landmark"], ["Museo de Bellas Artes", "museum"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: `2026-11-${28 + i}`,
    theme: name,
    activities: [{ name, type, description: "", location: "Seville" }],
  })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const museum = question.split("\n").find((line) => line.includes("Bellas Artes"));
        const places = museum ? [{ n: Number(museum.split(".")[0]), closed: ["Monday"] }] : [];
        return { response: { text: () => JSON.stringify({ places }), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

const themes = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-28", endDate: "2026-11-30", vibes: ["cultural"], ...extra }),
    })
  );
  expect(res.status).toBe(200);
  return ((await res.json()).itinerary.days as Array<{ theme: string }>).map((d) => d.theme);
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route", () => {
  it("orders a one-city plan's days so the museum is open", async () => {
    expect(await themes()).toEqual(["Real Alcázar", "Museo de Bellas Artes", "Plaza de España"]);
  });

  it("keeps a multi-city plan's days in their order", async () => {
    const legs = { destinations: [{ city: "Seville", nights: 2 }, { city: "Granada", nights: 1 }] };
    expect(await themes(legs)).toEqual(["Real Alcázar", "Plaza de España", "Museo de Bellas Artes"]);
  });
});
