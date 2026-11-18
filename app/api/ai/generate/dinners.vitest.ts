// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route (trips through several cities, plans around fixed
 * commitments) gives a full day left without dinner one too, as the stream
 * does: a restaurant near the place the day ends at, after that visit.
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

const stop = (start_time: string, name: string, type: string, lat = 35.0, lng = 135.77) => ({
  name,
  type,
  start_time,
  duration_minutes: 90,
  description: "",
  location: "Kyoto",
  coordinates: { lat, lng },
});
const plan = () => ({
  destination: { name: "Kyoto", country: "Japan" },
  days: [
    [stop("09:00", "Kinkaku-ji", "attraction")],
    [stop("09:00", "Fushimi Inari", "attraction"), stop("12:30", "Vermillion Cafe", "cafe"), stop("15:00", "Gion", "attraction", 35.0037, 135.7788)],
    [stop("09:00", "Nijo Castle", "landmark")],
  ].map((activities, i) => ({ day_number: i + 1, date: `2027-04-0${5 + i}`, theme: "t", activities })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const answer = question.startsWith("Name one real restaurant for dinner")
          ? { dinners: [{ n: 1, name: "Gion Nanba", description: "Seasonal kaiseki.", location: "Gion", coordinates: { lat: 35.0029, lng: 135.7751 } }] }
          : { places: [] };
        return { response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route", () => {
  it("gives a full day without dinner one, after the place the day ends at", async () => {
    const legs = { destinations: [{ city: "Kyoto", nights: 2 }, { city: "Osaka", nights: 1 }] };
    const res = await POST(
      new NextRequest("https://monkeytravel.app/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: "Kyoto & Osaka", startDate: "2027-04-05", endDate: "2027-04-07", vibes: ["cultural"], ...legs }),
      })
    );
    expect(res.status).toBe(200);
    const days = (await res.json()).itinerary.days as Array<{ activities: Array<{ name: string; start_time: string }> }>;
    expect(days[1].activities.map((a) => `${a.start_time} ${a.name}`)).toEqual([
      "09:00 Fushimi Inari",
      "12:30 Vermillion Cafe",
      "15:00 Gion",
      "18:30 Gion Nanba",
    ]);
  });
});
