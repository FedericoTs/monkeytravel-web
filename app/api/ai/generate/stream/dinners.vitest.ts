// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan that leaves a full day without dinner goes out with one on it: a
 * restaurant near the place the day ends at, after that visit. The log says
 * how many days had none and how many got one.
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

// Kyoto, three days: the middle one ends at Gion with no dinner.
const stop = (start_time: string, name: string, type: string, lat = 35.0, lng = 135.77) => ({
  name,
  type,
  start_time,
  duration_minutes: 90,
  description: "",
  location: "Kyoto",
  coordinates: { lat, lng },
});
const plan = () => ({
  destination: { name: "Kyoto", country: "Japan" },
  days: [
    [stop("09:00", "Kinkaku-ji", "attraction"), stop("12:30", "Okonomiyaki Kiraku", "restaurant"), stop("19:00", "Gion Karyo", "restaurant")],
    [stop("09:00", "Fushimi Inari", "attraction"), stop("12:30", "Vermillion Cafe", "cafe"), stop("15:00", "Gion", "attraction", 35.0037, 135.7788)],
    [stop("09:00", "Nijo Castle", "landmark"), stop("12:30", "Honke Owariya", "restaurant")],
  ].map((activities, i) => ({ day_number: i + 1, date: `2027-04-0${5 + i}`, theme: "t", activities })),
});
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    const text = JSON.stringify(plan());
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
// The closing-day question finds nothing shut; the dinners question names a restaurant near Gion.
const dinnerQuestions: string[] = [];
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const dinners = question.startsWith("Name one real restaurant for dinner");
        if (dinners) dinnerQuestions.push(question);
        const answer = dinners
          ? { dinners: [{ n: 1, name: "Gion Nanba", description: "Seasonal kaiseki.", location: "Gion", coordinates: { lat: 35.0029, lng: 135.7751 }, cost_per_person_usd: 80 }] }
          : { places: [] };
        return { response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
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
      body: JSON.stringify({ destination: "Kyoto, Japan", startDate: "2027-04-05", endDate: "2027-04-07", vibes: ["cultural"], budgetTier: "premium" }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  expect(events[events.length - 1].startsWith("event: complete")).toBe(true);
  const done = JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
  return (done.itinerary.days as Array<{ activities: Array<{ name: string; start_time: string; type: string }> }>).map((d) =>
    d.activities.map((a) => `${a.start_time} ${a.name}`)
  );
};

beforeEach(() => {
  logged.length = 0;
  dinnerQuestions.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a plan with a full day left without dinner", () => {
  it("goes out with a dinner after that day's last place, and says so in the log", async () => {
    const days = await complete();
    expect(days[1]).toEqual(["09:00 Fushimi Inari", "12:30 Vermillion Cafe", "15:00 Gion", "18:30 Gion Nanba"]);
    expect(days[0]).toContain("19:00 Gion Karyo");
    expect(dinnerQuestions).toHaveLength(1);
    expect(dinnerQuestions[0]).toContain("1. Kyoto, Japan, 2027-04-06: the day ends at Gion (35.00370, 135.77880)");
    expect(dinnerQuestions[0]).toContain("a special, upscale");
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata?.dinners).toEqual({ missing: 1, added: 1 });
  });
});
