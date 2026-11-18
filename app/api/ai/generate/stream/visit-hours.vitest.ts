// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan that keeps a visit past its place's closing time goes out with the
 * visit inside the place's listed hours: a winter afternoon at the Imperial
 * Palace East Gardens, which shut before five, trades slots with the
 * morning's walk. The log says how many visits were outside and what was done.
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
vi.mock("@/lib/ai/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/cache")>()),
  getCachedItinerary: async () => null,
  cacheItinerary: async () => {},
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [], knownPlacesUsed: () => 0 }));

// Thursday 28 January 2027: the gardens are open, and shut before five.
let gardenAt = "16:00";
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
        [gardenAt, "Imperial Palace East Gardens", "park"],
        ["18:00", "Dinner at Uobei Shibuya", "restaurant"],
      ].map(([start_time, name, type]) => ({ name, type, start_time, duration_minutes: 90, description: "", location: "Tokyo" })),
    },
  ],
});
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    const text = JSON.stringify(plan());
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
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

const complete = async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Tokyo, Japan", startDate: "2027-01-28", endDate: "2027-01-28", vibes: ["cultural"] }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  const done = JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
  return (done.itinerary.days[0].activities as Array<{ name: string; start_time: string }>).map((a) => `${a.start_time} ${a.name}`);
};
const metadata = async () => {
  await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
  return logged.find((row) => row.status === 200)?.metadata ?? {};
};

beforeEach(() => {
  logged.length = 0;
  gardenAt = "16:00";
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a plan with a garden visit after its closing time", () => {
  it("goes out with the visit in the morning, and says so in the log", async () => {
    expect(await complete()).toEqual([
      "09:00 Yoyogi Park",
      "10:45 Imperial Palace East Gardens",
      "12:30 Lunch at Afuri Harajuku",
      "16:00 Takeshita Street",
      "18:00 Dinner at Uobei Shibuya",
    ]);
    expect((await metadata()).visit_hours).toEqual({ checked: 1, outside: 1, moved: 1, shortened: 0 });
  });

  it("leaves a visit inside its hours where it is, and logs it as checked", async () => {
    gardenAt = "14:00";
    expect((await complete())[3]).toBe("14:00 Imperial Palace East Gardens");
    expect((await metadata()).visit_hours).toEqual({ checked: 1, outside: 0, moved: 0, shortened: 0 });
  });
});
