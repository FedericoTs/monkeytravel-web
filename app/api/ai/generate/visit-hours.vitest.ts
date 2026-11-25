// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route keeps a visit inside its place's listed hours, as the stream
 * does: a winter afternoon at the Imperial Palace East Gardens, which shut
 * before five, trades slots with the morning's walk. A multi-city plan too:
 * the visit moves within its own day.
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
const logged: Array<{ status?: number; metadata?: Record<string, unknown> }> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (row: (typeof logged)[number]) => void logged.push(row),
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
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));

// Thursday 28 January 2027: the gardens are open, and shut before five.
const plan = () => ({
  destination: { name: "Tokyo", country: "Japan" },
  days: [
    {
      day_number: 1,
      date: "2027-01-28",
      theme: "Gardens and Harajuku",
      activities: [
        ["09:00", "Yoyogi Park", "park"],
        ["10:45", "Takeshita Street", "attraction"],
        ["12:30", "Lunch at Afuri Harajuku", "restaurant"],
        ["16:00", "Imperial Palace East Gardens", "park"],
        ["18:00", "Dinner at Uobei Shibuya", "restaurant"],
      ].map(([start_time, name, type]) => ({ name, type, start_time, duration_minutes: 90, description: "", location: "Tokyo" })),
    },
  ],
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
// The closing-day question finds nothing shut.
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
      body: JSON.stringify({ destination: "Tokyo, Japan", startDate: "2027-01-28", endDate: "2027-01-28", vibes: ["cultural"], ...extra }),
    })
  );
  expect(res.status).toBe(200);
  const days = (await res.json()).itinerary.days as Array<{ activities: Array<{ name: string; start_time: string }> }>;
  return days[0].activities.map((a) => `${a.start_time} ${a.name}`);
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route", () => {
  it("moves a garden visit planned after its closing into the morning", async () => {
    expect(await stops()).toEqual([
      "09:00 Yoyogi Park",
      "10:45 Imperial Palace East Gardens",
      "12:30 Lunch at Afuri Harajuku",
      "16:00 Takeshita Street",
      "18:00 Dinner at Uobei Shibuya",
    ]);
    // The log says what the hours step did, as the stream says it.
    expect(logged.findLast((row) => row.status === 200)?.metadata?.visit_hours).toMatchObject({ outside: 1, moved: 1, shortened: 0 });
  });

  it("does the same on a multi-city trip, within the day", async () => {
    const legs = { destinations: [{ city: "Tokyo", nights: 1 }, { city: "Kyoto", nights: 1 }] };
    expect((await stops(legs))[1]).toBe("10:45 Imperial Palace East Gardens");
  });
});
