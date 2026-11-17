// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan that puts the Centre Pompidou, shut for renovation, on a Paris trip
 * goes out without it, a cached plan too, and the log line counts it.
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

// The plan the model writes: Thursday 24 to Saturday 26 December 2026, with the Centre Pompidou on day 2.
const plan = (dates: string[]) => ({
  destination: { name: "Paris", country: "France" },
  days: [["Louvre Museum", "museum"], ["Centre Pompidou", "museum"], ["Musée d'Orsay", "museum"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: dates[i],
    theme: name,
    activities: [
      { name, type, description: "", location: "Paris" },
      { name: `Lunch ${i + 1}`, type: "restaurant", description: "", location: "Paris" },
    ],
  })),
});
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    const text = JSON.stringify(plan(["2026-12-24", "2026-12-25", "2026-12-26"]));
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));

// The closing-day question: nothing shut on these days.
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
      body: JSON.stringify({ destination: "Paris, France", startDate: "2026-12-24", endDate: "2026-12-26", vibes: ["cultural"] }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  return { events, done: JSON.parse(events[events.length - 1].split("\ndata: ")[1]) };
};
const names = (days: Array<{ activities: Array<{ name: string }> }>) => days.map((d) => d.activities.map((a) => a.name).join(" + "));

beforeEach(() => {
  logged.length = 0;
  cached = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a Paris plan with the Centre Pompidou while it is shut", () => {
  it("goes out without it, the rest of the day kept, and the log counts it", async () => {
    const { done } = await complete();
    expect(names(done.itinerary.days)).toEqual(["Louvre Museum + Lunch 1", "Lunch 2", "Musée d'Orsay + Lunch 3"]);
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({ long_closures_removed: 1 });
  });

  it("from the cache too", async () => {
    cached = plan(["2026-11-01", "2026-11-02", "2026-11-03"]);
    const { events, done } = await complete();
    expect(events.some((e) => e.includes('"mode":"cache"'))).toBe(true);
    expect(names(done.itinerary.days).join(" | ")).not.toContain("Pompidou");
  });
});
