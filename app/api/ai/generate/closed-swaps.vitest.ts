// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route swaps a sight shut on every date of the trip for an open
 * place, as the stream does, in the plan's language.
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
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "it" }),
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

const DATES = ["2027-12-30", "2027-12-31", "2028-01-01"];
const plan = () => ({
  destination: { name: "Tokyo", country: "Japan" },
  days: [["Tokyo National Museum", "museum"], ["Meiji Jingu", "landmark"], ["Senso-ji", "landmark"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: DATES[i],
    theme: name,
    activities: [{ name, type, description: "", location: "Tokyo", start_time: "10:00", duration_minutes: 120 }],
  })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
const asked: string[] = [];
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        asked.push(question);
        const usageMetadata = { promptTokenCount: 80, candidatesTokenCount: 20 };
        if (question.includes("to go instead")) {
          const place = { name: "Mori Art Museum", type: "museum", description: "Arte a Roppongi.", location: "Roppongi", coordinates: { lat: 35.6605, lng: 139.7292 } };
          return { response: { text: () => JSON.stringify({ swaps: [{ n: 1, places: [place] }] }), usageMetadata } };
        }
        const museum = question.split("\n").find((line) => line.includes("Tokyo National Museum"));
        const places = museum ? [{ n: Number(museum.split(".")[0]), closed: [], shutOn: DATES }] : [];
        return { response: { text: () => JSON.stringify({ places }), usageMetadata } };
      },
    }),
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  asked.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route", () => {
  it("swaps the museum shut over New Year for an open one, asking in the plan's language", async () => {
    const res = await POST(
      new NextRequest("https://monkeytravel.app/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: "Tokyo, Japan", startDate: DATES[0], endDate: DATES[2], vibes: ["cultural"] }),
      })
    );
    expect(res.status).toBe(200);
    const days = (await res.json()).itinerary.days as Array<{ activities: Array<{ name: string; start_time: string }> }>;
    expect(days.map((d) => d.activities.map((a) => `${a.start_time} ${a.name}`).join(" + "))).toEqual([
      "10:00 Mori Art Museum",
      "10:00 Meiji Jingu",
      "10:00 Senso-ji",
    ]);
    expect(asked.find((q) => q.includes("to go instead"))).toContain("in Italian.");
  });
});
