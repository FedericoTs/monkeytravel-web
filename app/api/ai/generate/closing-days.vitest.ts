// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route orders a one-city plan's days around its sights' closing
 * days, as the stream does. A multi-city plan keeps its order: its days follow
 * the route from city to city.
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
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (entry: { metadata?: Record<string, unknown> }) => void logged.push(entry.metadata ?? {}),
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

// Saturday 28 to Monday 30 November, the museum on the Monday.
const plan = () => ({
  destination: { name: "Seville", country: "Spain" },
  days: [["Real Alcázar", "attraction"], ["Plaza de España", "landmark"], ["Museo de Bellas Artes", "museum"]].map(([name, type], i) => ({
    day_number: i + 1,
    date: `2026-11-${28 + i}`,
    theme: name,
    activities: [{ name, type, description: "", location: "Seville" }],
  })),
});
// Seville on Sunday 29 and Monday 30 November, the museum on the Monday; Granada on Tuesday 1 December.
const route = () => ({
  destination: { name: "Seville & Granada", country: "Spain" },
  days: [
    { city: "Seville", date: "2026-11-29", theme: "Plaza de España", activities: [{ name: "Plaza de España", type: "landmark", description: "", location: "Seville" }] },
    { city: "Seville", date: "2026-11-30", theme: "Museo de Bellas Artes", activities: [{ name: "Museo de Bellas Artes", type: "museum", description: "", location: "Seville" }] },
    {
      city: "Granada",
      date: "2026-12-01",
      theme: "Alhambra",
      activities: [
        { name: "Train to Granada", type: "transport", transport_mode: "train", start_time: "08:30", duration_minutes: 120, description: "", location: "Seville" },
        { name: "Alhambra", type: "attraction", start_time: "12:00", description: "", location: "Granada" },
      ],
    },
  ].map((day, i) => ({ ...day, day_number: i + 1 })),
});
// Seville on Monday 30 November only, the museum shut; Granada on Tuesday 1 (arriving) and Wednesday 2 December.
const shortSeville = () => ({
  destination: { name: "Seville & Granada", country: "Spain" },
  days: [
    { city: "Seville", date: "2026-11-30", theme: "Museo de Bellas Artes", activities: [{ name: "Museo de Bellas Artes", type: "museum", description: "", location: "Seville" }] },
    {
      city: "Granada",
      date: "2026-12-01",
      theme: "Alhambra",
      activities: [
        { name: "Train to Granada", type: "transport", transport_mode: "train", start_time: "08:30", duration_minutes: 120, description: "", location: "Seville" },
        { name: "Alhambra", type: "attraction", start_time: "12:00", description: "", location: "Granada" },
      ],
    },
    { city: "Granada", date: "2026-12-02", theme: "Albaicín", activities: [{ name: "Albaicín", type: "landmark", description: "", location: "Granada" }] },
  ].map((day, i) => ({ ...day, day_number: i + 1 })),
});
let multiCityPlan = route;
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({ validateLegs: () => {}, generateMultiCityItinerary: async () => multiCityPlan() }));
// The place the seasonal question (lib/ai/seasonal-closings.ts) names as shut for the trip, when a test sets one.
let shutForTheSeason: string | null = null;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async (question: string) => {
        if (question.includes("can't be visited")) {
          const line = shutForTheSeason ? question.split("\n").find((one) => one.includes(shutForTheSeason!)) : undefined;
          const shut = line ? [Number(line.split(".")[0])] : [];
          return { response: { text: () => JSON.stringify({ shut }), usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5 } } };
        }
        const museum = question.split("\n").find((line) => line.includes("Bellas Artes"));
        const places = museum ? [{ n: Number(museum.split(".")[0]), closed: ["Monday"] }] : [];
        return { response: { text: () => JSON.stringify({ places }), usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } } };
      },
    }),
  },
}));

const { POST } = await import("./route");

const planOf = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Seville, Spain", startDate: "2026-11-28", endDate: "2026-11-30", vibes: ["cultural"], ...extra }),
    })
  );
  expect(res.status).toBe(200);
  return (await res.json()).itinerary as { days: Array<{ theme: string }>; checked?: unknown };
};
const themes = async (extra: Record<string, unknown> = {}) => (await planOf(extra)).days.map((d) => d.theme);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the JSON route", () => {
  it("orders a one-city plan's days so the museum is open", async () => {
    expect(await themes()).toEqual(["Real Alcázar", "Museo de Bellas Artes", "Plaza de España"]);
  });

  it("orders each city's own days on a trip through several, the route kept, and logs it", async () => {
    logged.length = 0;
    const legs = { destinations: [{ city: "Seville", nights: 2 }, { city: "Granada", nights: 1 }], destination: "Seville & Granada", startDate: "2026-11-29", endDate: "2026-12-01" };
    expect(await themes(legs)).toEqual(["Museo de Bellas Artes", "Plaza de España", "Alhambra"]);
    // The Alhambra is on the checked list (lib/ai/known-closings.ts), open that Tuesday.
    expect(logged.at(-1)?.closing_days).toEqual({ asked: 3, known: 1, shut_before: 1, shut_listed: 0, shut_after: 0, stops_moved: 0, swapped: 0 });
  });

  it("never puts a city's day on another city's dates", async () => {
    logged.length = 0;
    multiCityPlan = shortSeville;
    const legs = { destinations: [{ city: "Seville", nights: 1 }, { city: "Granada", nights: 2 }], destination: "Seville & Granada", startDate: "2026-11-30", endDate: "2026-12-02" };
    // Seville has no other day: its museum stays on the Monday, and the log says so.
    expect(await themes(legs)).toEqual(["Museo de Bellas Artes", "Alhambra", "Albaicín"]);
    expect(logged.at(-1)?.closing_days).toMatchObject({ shut_before: 1, shut_after: 1, left: ["Museo de Bellas Artes (2026-11-30)"] });
    multiCityPlan = route;
  });

  it("tells the plan what was checked, for its screen to say", async () => {
    expect((await planOf()).checked).toEqual({ sights: 3, shut: 1, fixed: 1, left: 0 });
  });

  it("tells the plan when a sight is still on a day it's shut", async () => {
    multiCityPlan = shortSeville;
    const legs = { destinations: [{ city: "Seville", nights: 1 }, { city: "Granada", nights: 2 }], destination: "Seville & Granada", startDate: "2026-11-30", endDate: "2026-12-02" };
    try {
      expect((await planOf(legs)).checked).toMatchObject({ shut: 1, fixed: 0, left: 1 });
    } finally {
      multiCityPlan = route;
    }
  });

  it("logs the closing step of a one-city plan too", async () => {
    logged.length = 0;
    await themes();
    expect(logged.at(-1)?.closing_days).toMatchObject({ asked: 3, shut_before: 1, shut_after: 0 });
    expect(logged.at(-1)?.closing_days).not.toHaveProperty("seasonal");
  });

  it("logs a stop shut for the season apart from the closing days", async () => {
    logged.length = 0;
    shutForTheSeason = "Plaza de España";
    try {
      await themes();
      // Shut on every date, it has nowhere to go and no swap here: it stays, counted on its own.
      expect(logged.at(-1)?.closing_days).toMatchObject({ shut_before: 1, seasonal: 1, shut_after: 1 });
    } finally {
      shutForTheSeason = null;
    }
  });
});
