// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A stop name with two writing systems in one word ("Green波 Restaurant",
 * "Niku no万世 Akihabara Honten") gets its usual name once the plan is written,
 * on the JSON route as on the stream.
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
vi.mock("@/lib/activity-bank", () => ({ isActivityBankPopulated: async () => true, populateActivityBank: async () => ({}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));

const names = vi.hoisted(() => ({ list: ["Real Alcázar", "Plaza de España"] }));
const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: names.list.map((name, i) => ({
    day_number: i + 1,
    date: `2026-11-${28 + i}`,
    theme: name,
    activities: [{ name, type: "landmark", start_time: "10:00", duration_minutes: 120, description: "", location: "Seville", coordinates: { lat: 37.38, lng: -5.99 } }],
  })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
// The short questions after the plan: the usual names, and closing days (none).
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const answer = question.startsWith("In a travel plan for") ? { names: [{ number: 1, name: "Plaza de España" }] } : { places: [] };
        return { response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

const days = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-28", endDate: "2026-11-29", vibes: ["cultural"], ...extra }),
    })
  );
  expect(res.status).toBe(200);
  return ((await res.json()).itinerary.days as Array<{ activities: Array<{ name: string }> }>).map((d) => d.activities.map((a) => a.name).join(" + "));
};

beforeEach(() => {
  logged.length = 0;
  names.list = ["Real Alcázar", "Plaza de España"];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a glued stop name, on the JSON route", () => {
  it("gets its usual name, and the log says so", async () => {
    names.list = ["Real Alcázar", "Plaza de España波"];
    expect(await days()).toEqual(["Real Alcázar", "Plaza de España"]);
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({ names: { glued: 1, renamed: 1 } });
  });

  it("gets it on a multi-city plan too", async () => {
    names.list = ["Real Alcázar", "Plaza de España波"];
    const legs = { destinations: [{ city: "Seville", nights: 1 }, { city: "Granada", nights: 1 }] };
    expect(await days(legs)).toEqual(["Real Alcázar", "Plaza de España"]);
  });

  it("leaves a plan without one alone", async () => {
    expect(await days()).toEqual(["Real Alcázar", "Plaza de España"]);
    expect(logged.find((row) => row.status === 200)?.metadata).not.toHaveProperty("names");
  });
});
