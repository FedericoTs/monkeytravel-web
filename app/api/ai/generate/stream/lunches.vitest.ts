// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan that leaves a full day without lunch goes out with one on it: a
 * restaurant a short walk from the visit before it, the day's later stops
 * moved on to make room. The log says how many days had none and how many
 * got one.
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

// Kyoto, three days: the middle one goes from Fushimi Inari to Kiyomizu-dera with nothing to eat between.
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
    [
      stop("10:00", "Fushimi Inari", "attraction", 34.9671, 135.7727),
      stop("13:30", "Kiyomizu-dera", "attraction", 34.9949, 135.785),
      stop("19:00", "Pontocho Robin", "restaurant"),
    ],
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
// The closing-day question finds nothing shut; the lunch question names a restaurant by Fushimi Inari.
const lunchQuestions: string[] = [];
// Where the lunch answered is: by the shrine, unless a test moves it.
const BY_THE_SHRINE = { lat: 34.9677, lng: 135.7716 };
let lunchAt = BY_THE_SHRINE;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const lunch = question.startsWith("Name one real restaurant for lunch");
        if (lunch) lunchQuestions.push(question);
        const answer = lunch
          ? {
              lunches: [
                { n: 1, name: "Inari Sushi Koji", description: "Inari sushi by the shrine.", location: "Fushimi", coordinates: lunchAt, cost_per_person_usd: 15 },
              ],
            }
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
      body: JSON.stringify({ destination: "Kyoto, Japan", startDate: "2027-04-05", endDate: "2027-04-07", vibes: ["cultural"], budgetTier: "budget" }),
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
  lunchQuestions.length = 0;
  lunchAt = BY_THE_SHRINE;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a plan with a full day left without lunch", () => {
  it("goes out with a lunch after the visit before it, and says so in the log", async () => {
    const days = await complete();
    expect(days[1]).toEqual(["10:00 Fushimi Inari", "12:00 Inari Sushi Koji", "13:30 Kiyomizu-dera", "19:00 Pontocho Robin"]);
    expect(days[0]).toEqual(["09:00 Kinkaku-ji", "12:30 Okonomiyaki Kiraku", "19:00 Gion Karyo"]);
    // The same question, asked twice at once: a day the first answer can't fill takes the second's.
    expect(lunchQuestions).toHaveLength(2);
    expect(lunchQuestions[1]).toBe(lunchQuestions[0]);
    expect(lunchQuestions[0]).toContain("1. Kyoto, Japan, 2027-04-06: lunch at 12:00, after Fushimi Inari (34.96710, 135.77270)");
    expect(lunchQuestions[0]).toContain("inexpensive, where locals eat");
    // The plan's own places to eat are named, so the answer isn't one of them (it would be turned away).
    expect(lunchQuestions[0]).toContain("None the plan already has: Okonomiyaki Kiraku; Gion Karyo; Pontocho Robin; Honke Owariya.");
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata?.lunches).toEqual({ missing: 1, added: 1 });
  });

  it("logs why the day is still without lunch: here the answer is in Osaka, far from the shrine", async () => {
    lunchAt = { lat: 34.6687, lng: 135.5013 };
    const days = await complete();
    expect(days[1]).toEqual(["10:00 Fushimi Inari", "13:30 Kiyomizu-dera", "19:00 Pontocho Robin"]);
    await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
    expect(logged.find((row) => row.status === 200)?.metadata?.lunches).toEqual({ missing: 1, added: 0, left: { far: 1 } });
  });
});
