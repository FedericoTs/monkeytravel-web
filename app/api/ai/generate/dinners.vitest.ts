// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route (trips through several cities, plans around fixed
 * commitments) gives a full day left without dinner one too, as the stream
 * does: a restaurant near the place the day ends at, after that visit.
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

const stop = (start_time: string, name: string, type: string, lat = 35.0, lng = 135.77) => ({
  name,
  type,
  start_time,
  duration_minutes: 90,
  description: "",
  location: "Kyoto",
  coordinates: { lat, lng },
});
// Madrid, the same shape: the middle day ends at the Prado with no dinner.
const madrid = () => ({
  destination: { name: "Madrid", country: "Spain" },
  days: [
    [stop("09:00", "Royal Palace", "attraction", 40.418, -3.7143)],
    [stop("09:00", "Retiro Park", "park", 40.4153, -3.6845), stop("12:30", "Cafe Comercial", "cafe", 40.4321, -3.7029), stop("15:00", "Prado Museum", "museum", 40.4138, -3.6921)],
    [stop("09:00", "Reina Sofia", "museum", 40.4086, -3.6943)],
  ].map((activities, i) => ({ day_number: i + 1, date: `2027-04-0${5 + i}`, theme: "t", activities })),
});
let inMadrid = false;
const plan = () => (inMadrid ? madrid() : kyoto());
const kyoto = () => ({
  destination: { name: "Kyoto", country: "Japan" },
  days: [
    [stop("09:00", "Kinkaku-ji", "attraction")],
    [stop("09:00", "Fushimi Inari", "attraction"), stop("12:30", "Vermillion Cafe", "cafe"), stop("15:00", "Gion", "attraction", 35.0037, 135.7788)],
    [stop("09:00", "Nijo Castle", "landmark")],
  ].map((activities, i) => ({ day_number: i + 1, date: `2027-04-0${5 + i}`, theme: "t", activities })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
const dinnerQuestions: string[] = [];
// Where the answered restaurant is: near Gion, unless a test moves it.
const GION = { lat: 35.0029, lng: 135.7751 };
let answeredAt = GION;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        if (question.startsWith("Name one real restaurant for dinner")) dinnerQuestions.push(question);
        const answer = question.startsWith("Name one real restaurant for dinner")
          ? { dinners: [{ n: 1, name: inMadrid ? "Casa Lucio" : "Gion Nanba", description: "Seasonal kaiseki.", location: "Gion", coordinates: answeredAt }] }
          : { places: [] };
        return { response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  logged.length = 0;
  answeredAt = GION;
  inMadrid = false;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const legs = () =>
  inMadrid
    ? { destination: "Madrid & Toledo", destinations: [{ city: "Madrid", nights: 2 }, { city: "Toledo", nights: 1 }] }
    : { destination: "Kyoto & Osaka", destinations: [{ city: "Kyoto", nights: 2 }, { city: "Osaka", nights: 1 }] };
const generate = (extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2027-04-05", endDate: "2027-04-07", vibes: ["cultural"], ...legs(), ...extra }),
    })
  );

describe("the JSON route", () => {
  it("logs why a day is still without dinner: here the answer is in Osaka, far from Gion", async () => {
    answeredAt = { lat: 34.6687, lng: 135.5013 };
    expect((await generate()).status).toBe(200);
    expect(logged.find((row) => row.status === 200)?.metadata?.dinners).toEqual({ missing: 1, added: 0, left: { far: 1 } });
  });

  it("has it at the local hour in Spain, and at 18:30 for a family with a toddler", async () => {
    inMadrid = true;
    answeredAt = { lat: 40.4122, lng: -3.7092 };
    const middleDay = async (extra: Record<string, unknown> = {}) => {
      const days = (await (await generate(extra)).json()).itinerary.days as Array<{ activities: Array<{ name: string; start_time: string }> }>;
      return days[1].activities.map((a) => `${a.start_time} ${a.name}`);
    };
    expect(await middleDay()).toEqual(["09:00 Retiro Park", "12:30 Cafe Comercial", "15:00 Prado Museum", "20:30 Casa Lucio"]);
    expect(await middleDay({ tripIntent: "family", childrenAges: ["under3"] })).toContain("18:30 Casa Lucio");
  });

  it("gives a full day without dinner one, after the place the day ends at", async () => {
    const res = await generate();
    expect(res.status).toBe(200);
    const days = (await res.json()).itinerary.days as Array<{ activities: Array<{ name: string; start_time: string }> }>;
    expect(days[1].activities.map((a) => `${a.start_time} ${a.name}`)).toEqual([
      "09:00 Fushimi Inari",
      "12:30 Vermillion Cafe",
      "15:00 Gion",
      "18:30 Gion Nanba",
    ]);
    // The plan's own places to eat are named, so the answer isn't one of them.
    expect(dinnerQuestions.at(-1)).toContain("None the plan already has: Vermillion Cafe.");
    // The log says how many full days had no dinner and how many got one, as the stream says it.
    expect(logged.find((row) => row.status === 200)?.metadata?.dinners).toEqual({ missing: 1, added: 1 });
  });
});
