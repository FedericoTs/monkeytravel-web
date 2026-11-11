// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan that puts a sight on the day it shuts goes out with its days in an
 * order that keeps it open: Seville's fine-arts museum, shut on Mondays, moves
 * off the Monday. A cached plan, given this request's dates, is checked too.
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
let cached: object | null = null;
vi.mock("@/lib/ai/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/cache")>()),
  getCachedItinerary: async () => cached,
  cacheItinerary: async () => {},
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [], knownPlacesUsed: () => 0 }));

// The plan the model writes: Saturday 28 to Monday 30 November, the museum on the Monday.
const plan = (dates: string[]) => ({
  destination: { name: "Seville", country: "Spain" },
  days: [["Real Alcázar", "attraction"], ["Plaza de España", "landmark"], ["Museo de Bellas Artes", "museum"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: dates[i],
    theme: name,
    activities: [{ name, type, description: "", location: "Seville" }],
  })),
});
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    const text = JSON.stringify(plan(["2026-11-28", "2026-11-29", "2026-11-30"]));
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));

// The short question about the plan's places: the museum is shut on Mondays.
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

const complete = async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-28", endDate: "2026-11-30", vibes: ["cultural"] }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  return { events, done: JSON.parse(events[events.length - 1].split("\ndata: ")[1]) };
};
const order = (days: Array<{ date: string; theme: string }>) => days.map((d) => `${d.date} ${d.theme}`);

beforeEach(() => {
  logged.length = 0;
  cached = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a plan with a sight on the day it shuts", () => {
  it("goes out with its days ordered so the sight is open, and says so in the log", async () => {
    const { done } = await complete();
    expect(order(done.itinerary.days)).toEqual(["2026-11-28 Real Alcázar", "2026-11-29 Museo de Bellas Artes", "2026-11-30 Plaza de España"]);
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({
      closing_days: { asked: 3, shut_before: 1, shut_after: 0 },
    });
  });

  it("from the cache, on this request's dates, is ordered the same way", async () => {
    // Cached on Tuesday to Thursday, when the museum is open.
    cached = plan(["2026-12-01", "2026-12-02", "2026-12-03"]);
    const { events, done } = await complete();
    expect(events.some((e) => e.includes('"mode":"cache"'))).toBe(true);
    expect(order(done.itinerary.days)).toEqual(["2026-11-28 Real Alcázar", "2026-11-29 Museo de Bellas Artes", "2026-11-30 Plaza de España"]);
  });
});
