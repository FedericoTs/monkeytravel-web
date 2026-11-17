// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Over New Year in Tokyo the national museum is shut on every date of the trip,
 * so no order of the days and no move keeps it open. The plan goes out with an
 * open place in its time instead, and the log line counts the swap.
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

const DATES = ["2027-12-30", "2027-12-31", "2028-01-01"];
// The plan the model writes: Thursday 30 December 2027 to Saturday 1 January 2028.
const plan = () => ({
  destination: { name: "Tokyo", country: "Japan" },
  days: [["Tokyo National Museum", "museum"], ["Meiji Jingu", "landmark"], ["Senso-ji", "landmark"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: DATES[i],
    theme: name,
    activities: [{ name, type, description: "", location: "Tokyo", start_time: "10:00", duration_minutes: 120 }],
  })),
});
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    const text = JSON.stringify(plan());
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));

// The closing question: the museum is shut on every date asked. The swap question: another museum instead,
// which the closing question then finds open, unless the test says it is shut too.
const asked: string[] = [];
let swapShut = false;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        asked.push(question);
        const usageMetadata = { promptTokenCount: 80, candidatesTokenCount: 20 };
        if (question.includes("place to go instead")) {
          const swaps = [
            {
              n: 1,
              activity: {
                start_time: "11:00",
                duration_minutes: 90,
                name: "Mori Art Museum",
                type: "museum",
                description: "Art above Roppongi.",
                location: "Roppongi",
                coordinates: { lat: 35.6605, lng: 139.7292 },
              },
            },
          ];
          return { response: { text: () => JSON.stringify({ swaps }), usageMetadata } };
        }
        const museum = question.split("\n").find((line) => line.includes("Tokyo National Museum") || (swapShut && line.includes("Mori Art Museum")));
        const places = museum ? [{ n: Number(museum.split(".")[0]), closed: [], shutOn: DATES }] : [];
        return { response: { text: () => JSON.stringify({ places }), usageMetadata } };
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
      body: JSON.stringify({ destination: "Tokyo, Japan", startDate: DATES[0], endDate: DATES[2], vibes: ["cultural"] }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  return JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
};

beforeEach(() => {
  logged.length = 0;
  asked.length = 0;
  swapShut = false;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a sight shut on every date of the trip", () => {
  it("goes out swapped for an open place in its time, and the log counts it", async () => {
    const done = await complete();
    const first = done.itinerary.days[0].activities[0];
    expect(first).toMatchObject({ name: "Mori Art Museum", start_time: "10:00", duration_minutes: 120, location: "Roppongi" });
    expect(JSON.stringify(done.itinerary)).not.toContain("Tokyo National Museum");
    expect(asked.filter((q) => q.includes("place to go instead"))).toHaveLength(1);
    expect(asked.find((q) => q.includes("place to go instead"))).toContain("Day 1 (Thursday 2027-12-30), 10:00-12:00: Tokyo National Museum");
    // The swap itself was asked about on its date before it went in.
    expect(asked.some((q) => q.includes("1. Mori Art Museum") && q.includes("2027-12-30 (Thursday)"))).toBe(true);
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({
      closing_days: { asked: 3, shut_before: 1, shut_after: 0, stops_moved: 0, swapped: 1 },
    });
  });

  it("keeps the closed sight when the place offered instead is shut that day too", async () => {
    swapShut = true;
    const done = await complete();
    expect(done.itinerary.days[0].activities[0].name).toBe("Tokyo National Museum");
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({
      closing_days: { shut_before: 1, shut_after: 1, swapped: 0 },
    });
  });
});
