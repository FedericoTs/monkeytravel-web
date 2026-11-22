// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The stream tells the closing step which stops the traveller asked for by
 * name: a must-do shut on its day takes the place of a sight nobody asked for
 * on the one day it is open, instead of being left behind.
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
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async () => {},
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

// Monday 30 November and Tuesday 1 December. All three sights are shut on Mondays: the museum can only go to the
// Tuesday, which the house and the tower fill until the late afternoon.
const sight = (name: string, type: string, start_time: string, duration_minutes: number) => ({
  name,
  type,
  start_time,
  duration_minutes,
  description: "",
  location: "Seville",
});
const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: [
    { day_number: 1, date: "2026-11-30", theme: "Fine arts", activities: [sight("Museo de Bellas Artes", "museum", "10:00", 120)] },
    {
      day_number: 2,
      date: "2026-12-01",
      theme: "Old town",
      activities: [sight("Casa de Pilatos", "landmark", "10:00", 300), sight("Torre del Oro", "landmark", "15:20", 150)],
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
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const places = question
          .split("\n")
          .filter((line) => /^\d+\. .*(Bellas Artes|Pilatos|Torre del Oro)/.test(line))
          .map((line) => ({ n: Number(line.split(".")[0]), closed: ["Monday"] }));
        return { response: { text: () => JSON.stringify({ places }), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

const days = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-30", endDate: "2026-12-01", vibes: ["cultural"], ...extra }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  const done = JSON.parse(events[events.length - 1].split("\ndata: ")[1]) as {
    itinerary: { days: Array<{ date: string; activities: Array<{ name: string; start_time: string }> }> };
  };
  return done.itinerary.days.map((d) => `${d.date}: ${d.activities.map((a) => `${a.start_time} ${a.name}`).join(" | ")}`);
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a must-do shut on its day, on the stream", () => {
  it("takes the place of a sight nobody asked for on the day it is open", async () => {
    expect(await days({ mustDos: ["Museo de Bellas Artes"] })).toEqual([
      "2026-11-30: 10:00 Casa de Pilatos",
      "2026-12-01: 10:00 Museo de Bellas Artes | 15:20 Torre del Oro",
    ]);
  });

  it("stays where it is when it wasn't asked for: no sight deserves the day more", async () => {
    expect(await days()).toEqual(["2026-11-30: 10:00 Museo de Bellas Artes", "2026-12-01: 10:00 Casa de Pilatos | 15:20 Torre del Oro"]);
  });
});
