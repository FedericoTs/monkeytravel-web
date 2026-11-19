// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A trip through several cities asks how travellers make each hop between them (lib/ai/transfer-question.ts):
 * the request's log says how many hops there were, how many the answer covered, and how many of those the
 * cards could take.
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
  refundAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (entry: { metadata?: Record<string, unknown> }) => {
    logged.push(entry.metadata ?? {});
  },
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

const stop = (name: string, lat: number, lng: number) => ({
  name,
  type: "attraction",
  start_time: "10:00",
  duration_minutes: 90,
  description: "",
  location: "",
  coordinates: { lat, lng },
});
const plan = () => ({
  destination: { name: "Brussels & Paris", country: "Belgium" },
  days: [
    { day_number: 1, date: "2027-04-05", theme: "t", activities: [stop("Grand-Place", 50.8467, 4.3525)] },
    { day_number: 2, date: "2027-04-06", theme: "t", activities: [stop("Louvre", 48.8606, 2.3376)] },
  ],
});
vi.mock("@/lib/gemini", () => ({ generateItinerary: async () => plan() }));
vi.mock("@/lib/ai/multi-city", () => ({
  validateLegs: () => {},
  generateMultiCityItinerary: async (
    _base: unknown,
    legs: unknown[],
    _start: string,
    _options: unknown,
    onTransfers?: (report: { hops: number; answered: number; used: number }) => void
  ) => {
    onTransfers?.({ hops: legs.length - 1, answered: 1, used: 1 });
    return plan();
  },
}));

const { POST } = await import("./route");

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2027-04-05", endDate: "2027-04-06", vibes: ["cultural"], ...body }),
    })
  );

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  logged.length = 0;
});

describe("the JSON route's log of a trip through several cities", () => {
  it("says how many hops there were, how many were answered and how many the cards took", async () => {
    const res = await post({ destination: "Brussels & Paris", destinations: [{ city: "Brussels", nights: 1 }, { city: "Paris", nights: 1 }] });
    expect(res.status).toBe(200);
    expect(logged.at(-1)?.transfers).toEqual({ hops: 1, answered: 1, used: 1 });
  });

  it("has no such line for a trip to one place", async () => {
    const res = await post({ destination: "Brussels" });
    expect(res.status).toBe(200);
    expect(logged.at(-1)).not.toHaveProperty("transfers");
  });

  it("names the place a route offered on step 1 was taken for, on a trip through several cities only", async () => {
    const legs = [{ city: "Brussels", nights: 1 }, { city: "Paris", nights: 1 }];
    await post({ destination: "Brussels & Paris", destinations: legs, routeFrom: "  Benelux and France " });
    expect(logged.at(-1)?.route_from).toBe("Benelux and France");
    await post({ destination: "Brussels & Paris", destinations: legs });
    expect(logged.at(-1)).not.toHaveProperty("route_from");
    await post({ destination: "Brussels", routeFrom: "Belgium" });
    expect(logged.at(-1)).not.toHaveProperty("route_from");
    await post({ destination: "Brussels & Paris", destinations: legs, routeFrom: { place: "Belgium" } });
    expect(logged.at(-1)).not.toHaveProperty("route_from");
  });
});
