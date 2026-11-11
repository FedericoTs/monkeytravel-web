// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A must-do the written plan holds nowhere goes in before the plan is sent:
 * the days shown while it was written are replaced by `complete`'s. Seville's
 * Metropol Parasol was asked for and left out.
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

const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: ["Real Alcázar", "Plaza de España"].map((name, i) => ({
    day_number: i + 1,
    date: `2026-11-${28 + i}`,
    theme: name,
    activities: [{ name, type: "landmark", start_time: "10:00", duration_minutes: 120, description: "", location: "Seville", coordinates: { lat: 37.38, lng: -5.99 } }],
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
// The short questions after the plan: where the missing must-do goes, and closing days (none).
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const parasol = { start_time: "17:00", duration_minutes: 90, name: "Metropol Parasol", type: "landmark", description: "", location: "Encarnación", coordinates: { lat: 37.3934, lng: -5.9917 } };
        const answer = question.startsWith("The traveller asked for these by name") ? { added: [{ must_do: 1, day_number: 2, activity: parasol }], left_out: [] } : { places: [] };
        return { response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

const complete = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-28", endDate: "2026-11-29", vibes: ["cultural"], ...extra }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  const done = JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
  return (done.itinerary.days as Array<{ activities: Array<{ name: string }> }>).map((d) => d.activities.map((a) => a.name).join(" + "));
};

beforeEach(() => {
  logged.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a must-do the plan holds nowhere, on the stream", () => {
  it("is in the plan `complete` sends, and the log says so", async () => {
    expect(await complete({ mustDos: ["Metropol Parasol"] })).toEqual(["Real Alcázar", "Plaza de España + Metropol Parasol"]);
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata).toMatchObject({ must_dos: { missing: 1, added: 1 } });
  });

  it("leaves a plan without must-dos alone", async () => {
    expect(await complete()).toEqual(["Real Alcázar", "Plaza de España"]);
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata).not.toHaveProperty("must_dos");
  });
});
