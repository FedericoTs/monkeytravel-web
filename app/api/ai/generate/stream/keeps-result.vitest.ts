// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A streamed plan is kept under the request's generation id before `complete`
 * goes out, so a browser that loses the end of the stream still finds it.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) }));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: undefined, userLanguage: "en" }),
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async () => {},
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

const itinerary = {
  destination: { name: "Rome", country: "Italy" },
  days: [1, 2].map((n) => ({
    day_number: n,
    date: `2026-11-0${n}`,
    title: `Day ${n}`,
    activities: [{ name: `Sight ${n}`, type: "attraction", description: "", location: "Rome" }],
  })),
};
vi.mock("@/lib/gemini", () => ({
  validateTripParams: () => ({ valid: true }),
  generateItineraryStream: async function* () {
    const text = JSON.stringify(itinerary);
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
  parseStreamedItinerary: (text: string) => JSON.parse(text),
}));

const { POST } = await import("./route");
const { findGeneration } = await import("@/lib/ai/generation-result");
const { GENERATION_ID_HEADER, newGenerationId } = await import("@/lib/ai/generation-id");

describe("a streamed generation", () => {
  it("is kept under the request's generation id, as `complete` sent it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const id = newGenerationId();
    const res = await POST(
      new NextRequest("http://localhost/api/ai/generate/stream", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "mt_session_id=s1", [GENERATION_ID_HEADER]: id },
        body: JSON.stringify({ destination: "Rome, Italy", startDate: "2026-11-01", endDate: "2026-11-02", vibes: ["cultural"] }),
      })
    );
    const events = (await res.text()).split("\n\n").filter(Boolean);
    const complete = JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
    expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
    expect(await findGeneration(id, "s1")).toEqual({ itinerary: complete.itinerary, meta: complete.meta });
  });
});
