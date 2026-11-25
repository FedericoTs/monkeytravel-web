// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The days of a plan can move after the dinners were asked for: a museum shut on the last day's date takes the
 * middle day's, and the last day, planned light and without dinner for the way home, becomes a full day in the
 * middle of the trip. That day's dinner is asked for once the days have moved, and the log says so.
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
const logged: Array<{ status?: number; costUsd?: number; metadata?: Record<string, unknown> }> = [];
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
// A question's cost is its prompt tokens in millionths of a dollar: the dinner questions are told apart by theirs.
vi.mock("@/lib/ai/gemini-cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-cost")>()),
  geminiCostUsd: (_model: string, usage?: { promptTokenCount?: number }) => (usage?.promptTokenCount ?? 0) / 1e6,
}));

// Seville, Saturday 28 to Monday 30 November 2026. Each day has lunch; the first two have dinner; the last, the day
// home, has none. The museum on the Monday is shut on Mondays.
const stop = (start_time: string, name: string, type: string, lat: number, lng: number) => ({
  name,
  type,
  start_time,
  duration_minutes: 90,
  description: "",
  location: "Seville",
  coordinates: { lat, lng },
});
const DAYS = [
  [
    stop("09:30", "Real Alcázar", "attraction", 37.3831, -5.9902),
    stop("13:00", "Bodega Santa Cruz", "restaurant", 37.3866, -5.9908),
    stop("15:00", "Catedral de Sevilla", "landmark", 37.3858, -5.9933),
    stop("20:00", "Eslava", "restaurant", 37.3994, -5.9963),
  ],
  [
    stop("09:30", "Plaza de España", "landmark", 37.3772, -5.9869),
    stop("13:00", "Casa Morales", "restaurant", 37.3878, -5.9943),
    stop("15:00", "Parque de María Luisa", "park", 37.3747, -5.9886),
    stop("20:00", "El Rinconcillo", "restaurant", 37.3948, -5.9887),
  ],
  [
    stop("10:00", "Museo de Bellas Artes", "museum", 37.3936, -6.0),
    stop("12:30", "La Azotea", "restaurant", 37.3925, -5.9958),
    stop("14:30", "Metropol Parasol", "attraction", 37.3932, -5.9918),
  ],
];
let days = DAYS;
const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: days.map((activities, i) => ({ day_number: i + 1, date: `2026-11-${28 + i}`, theme: activities[0].name, activities })),
});
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    const text = JSON.stringify(plan());
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));

// The closing question: the museum is shut on Mondays. The dinners question: a restaurant near Metropol Parasol,
// unless a test moves it.
const NEAR_PARASOL = { lat: 37.3929, lng: -5.9925 };
let dinnerAt = NEAR_PARASOL;
const dinnerQuestions: string[] = [];
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        if (question.startsWith("Name one real restaurant for dinner")) {
          dinnerQuestions.push(question);
          const answer = { dinners: [{ n: 1, name: "Bar Antojo", description: "Andalusian tapas.", location: "Encarnación", coordinates: dinnerAt, cost_per_person_usd: 30 }] };
          return { response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 7000, candidatesTokenCount: 20 } } };
        }
        const museum = question.split("\n").find((line) => line.includes("Bellas Artes"));
        const places = museum && !question.includes("can't be visited") ? [{ n: Number(museum.split(".")[0]), closed: ["Monday"] }] : [];
        return { response: { text: () => JSON.stringify({ places, shut: [] }), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
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
  const done = JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
  return (done.itinerary.days as Array<{ date: string; activities: Array<{ name: string; start_time: string }> }>).map(
    (d) => `${d.date}: ${d.activities.map((a) => `${a.start_time} ${a.name}`).join(", ")}`
  );
};
const planRow = async () => {
  await vi.waitFor(() => expect(logged.find((row) => row.status === 200)).toBeTruthy());
  return logged.find((row) => row.status === 200)!;
};

beforeEach(() => {
  logged.length = 0;
  dinnerQuestions.length = 0;
  days = DAYS;
  dinnerAt = NEAR_PARASOL;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a day the closing days move into the middle of the trip", () => {
  it("gets its dinner after its last place, asked for once the days have moved", async () => {
    const out = await complete();
    // The museum's day goes to the Sunday, and the Sunday's to the Monday, as the closing days order them.
    expect(out).toEqual([
      "2026-11-28: 09:30 Real Alcázar, 13:00 Bodega Santa Cruz, 15:00 Catedral de Sevilla, 20:00 Eslava",
      "2026-11-29: 10:00 Museo de Bellas Artes, 12:30 La Azotea, 14:30 Metropol Parasol, 18:30 Bar Antojo",
      "2026-11-30: 09:30 Plaza de España, 13:00 Casa Morales, 15:00 Parque de María Luisa, 20:00 El Rinconcillo",
    ]);
    // Asked for that day alone, on its new date, twice at once as every dinner question is.
    expect(dinnerQuestions).toHaveLength(2);
    expect(dinnerQuestions[0]).toContain("1. Seville, Spain, 2026-11-29: the day ends at Metropol Parasol");
    expect(dinnerQuestions[0]).not.toContain("2.");
  });

  it("logs the day among those without dinner, as found after the move, with the questions in the plan's cost", async () => {
    await complete();
    const row = await planRow();
    expect(row.metadata?.dinners).toEqual({ missing: 1, added: 1, after_move: 1 });
    expect(row.costUsd).toBeGreaterThanOrEqual(0.014);
  });

  it("logs why the moved day still has no dinner when its answer is turned away: here, a restaurant in Cádiz", async () => {
    dinnerAt = { lat: 36.5298, lng: -6.2927 };
    const out = await complete();
    expect(out[1]).toBe("2026-11-29: 10:00 Museo de Bellas Artes, 12:30 La Azotea, 14:30 Metropol Parasol");
    expect((await planRow()).metadata?.dinners).toEqual({ missing: 1, added: 0, after_move: 1, left: { far: 1 } });
  });

  it("asks nothing more when no day moved", async () => {
    // The museum on the Saturday, open: the days keep their order, and every middle day already has dinner.
    days = [DAYS[2].map((s) => s), DAYS[1], DAYS[0].filter((s) => s.name !== "Eslava")];
    const out = await complete();
    expect(out[0].startsWith("2026-11-28: 10:00 Museo de Bellas Artes")).toBe(true);
    expect(dinnerQuestions).toHaveLength(0);
    expect((await planRow()).metadata).not.toHaveProperty("dinners");
  });
});
