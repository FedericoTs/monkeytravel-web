// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TripCreationParams } from "@/types";

/**
 * A place typed and not picked sends no point. The stream route finds it in
 * the cities table, so its plan gets the sunrise and sunset and what's on there.
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
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
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
vi.mock("@/lib/ai/place-point", () => ({
  placePointFor: async (name: string) => (name === "Prague" ? { lat: 50.0755, lng: 14.4378 } : null),
}));
vi.mock("@/lib/ai/city-points", () => ({
  cityPointsFor: async (cities: string[]) => cities.map((c) => (c === "Prague" ? { lat: 50.0755, lng: 14.4378 } : null)),
}));

/** The trip each plan was asked for. */
const asked: TripCreationParams[] = [];
const plan = {
  destination: { name: "Prague", country: "Czechia" },
  days: ["2026-12-08", "2026-12-09", "2026-12-10"].map((date, i) => ({
    day_number: i + 1,
    date,
    theme: "Old Town",
    activities: [{ name: "Charles Bridge", type: "landmark", description: "", location: "Prague" }],
  })),
};
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* (p: TripCreationParams) {
    asked.push(p);
    const text = JSON.stringify(plan);
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
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

beforeEach(() => {
  asked.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the stream route, for a place typed and not picked", () => {
  it("plans it with its sun and what's on there", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/ai/generate/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: "Prague", startDate: "2026-12-08", endDate: "2026-12-10", vibes: ["cultural"] }),
      })
    );
    const events = (await res.text()).split("\n\n").filter(Boolean);
    expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0].whatsOn).toEqual([expect.stringMatching(/Christmas markets are open/)]);
    expect(asked[0].daylight?.first.sunset).toMatch(/^1[56]:[0-5]\d$/);
  });
});
