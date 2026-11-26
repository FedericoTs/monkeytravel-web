// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route asks for lunches before the closing days settle, as the stream does: a last day planned light,
 * without lunch, that a museum shut on its date moves into the middle of the trip gets its lunch asked for once the
 * days have moved, and the log says so.
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

// Seville, Saturday 28 to Monday 30 November 2026: the last day, the day home, has neither lunch nor dinner, and its
// museum is shut on Mondays.
const stop = (start_time: string, name: string, type: string, lat: number, lng: number) => ({
  name,
  type,
  start_time,
  duration_minutes: 90,
  description: "",
  location: "Seville",
  coordinates: { lat, lng },
});
const SATURDAY = [
  stop("09:30", "Real Alcázar", "attraction", 37.3831, -5.9902),
  stop("13:00", "Bodega Santa Cruz", "restaurant", 37.3866, -5.9908),
  stop("15:00", "Catedral de Sevilla", "landmark", 37.3858, -5.9933),
  stop("20:00", "Eslava", "restaurant", 37.3994, -5.9963),
];
const SUNDAY = [
  stop("09:30", "Plaza de España", "landmark", 37.3772, -5.9869),
  stop("13:00", "Casa Morales", "restaurant", 37.3878, -5.9943),
  stop("15:00", "Parque de María Luisa", "park", 37.3747, -5.9886),
  stop("20:00", "El Rinconcillo", "restaurant", 37.3948, -5.9887),
];
const MONDAY = [stop("10:00", "Museo de Bellas Artes", "museum", 37.3936, -6.0), stop("14:30", "Metropol Parasol", "attraction", 37.3932, -5.9918)];
let days = [SATURDAY, SUNDAY, MONDAY];
const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: days.map((activities, i) => ({ day_number: i + 1, date: `2026-11-${28 + i}`, theme: activities[0].name, activities })),
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => plan() }));
const lunchQuestions: string[] = [];
// Where the lunch answered is: by the museum, unless a test moves it.
const BY_THE_MUSEUM = { lat: 37.3925, lng: -5.9958 };
let lunchAt = BY_THE_MUSEUM;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        const reply = (answer: unknown) => ({
          response: { text: () => JSON.stringify(answer), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } },
        });
        if (question.startsWith("Name one real restaurant for lunch")) {
          lunchQuestions.push(question);
          return reply({ lunches: [{ n: 1, name: "La Azotea", description: "Modern Andalusian.", location: "Feria", coordinates: lunchAt }] });
        }
        if (question.startsWith("Name one real restaurant for dinner")) return reply({ dinners: [] });
        const museum = question.split("\n").find((line) => line.includes("Bellas Artes"));
        const places = museum && !question.includes("can't be visited") ? [{ n: Number(museum.split(".")[0]), closed: ["Monday"] }] : [];
        return reply({ places, shut: [] });
      },
    }),
  },
}));

const { POST } = await import("./route");

const plannedDays = async () => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-28", endDate: "2026-11-30", vibes: ["cultural"] }),
    })
  );
  expect(res.status).toBe(200);
  const out = (await res.json()).itinerary.days as Array<{ date: string; activities: Array<{ name: string; start_time: string }> }>;
  return out.map((d) => `${d.date}: ${d.activities.map((a) => `${a.start_time} ${a.name}`).join(", ")}`);
};

beforeEach(() => {
  logged.length = 0;
  lunchQuestions.length = 0;
  lunchAt = BY_THE_MUSEUM;
  days = [SATURDAY, SUNDAY, MONDAY];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route, when the closing days move a day into the middle of the trip", () => {
  it("gives it lunch after its morning visit, asked for once the days have moved, and logs it", async () => {
    const out = await plannedDays();
    expect(out[1]).toBe("2026-11-29: 10:00 Museo de Bellas Artes, 12:00 La Azotea, 14:30 Metropol Parasol");
    expect(lunchQuestions).toHaveLength(2);
    expect(lunchQuestions[0]).toContain("1. Seville, Spain, 2026-11-29: lunch at 12:00, after Museo de Bellas Artes");
    expect(logged.find((row) => row.status === 200)?.metadata?.lunches).toEqual({ missing: 1, added: 1, after_move: 1 });
  });

  it("logs why the moved day is still without lunch: here the answer is in Cádiz, far from the museum", async () => {
    lunchAt = { lat: 36.5298, lng: -6.2924 };
    const out = await plannedDays();
    expect(out[1]).toBe("2026-11-29: 10:00 Museo de Bellas Artes, 14:30 Metropol Parasol");
    expect(logged.find((row) => row.status === 200)?.metadata?.lunches).toEqual({ missing: 1, added: 0, after_move: 1, left: { far: 1 } });
  });

  it("asks a day without lunch once when it doesn't move", async () => {
    days = [MONDAY.map((s) => s), SUNDAY.filter((s) => s.name !== "Casa Morales"), SATURDAY];
    const out = await plannedDays();
    expect(out[1]).toBe("2026-11-29: 09:30 Plaza de España, 12:00 La Azotea, 15:00 Parque de María Luisa, 20:00 El Rinconcillo");
    expect(lunchQuestions).toHaveLength(2);
    expect(logged.find((row) => row.status === 200)?.metadata?.lunches).toEqual({ missing: 1, added: 1 });
  });
});
