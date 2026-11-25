/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The add-activity search falls back to Google's (legacy) Text Search for a
 * signed-in user when the trips we know have too few matches. That call is
 * paid and is logged like every other Places call; the local search is not.
 */

vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

let localRows: Array<Record<string, unknown>>;
const rpcArgs: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      rpcArgs.push(args);
      return { data: localRows, error: null };
    },
  }),
}));
// Where the cities table puts a city; any other place is unknown.
const POINTS: Record<string, { lat: number; lng: number }> = {
  Florence: { lat: 43.7696, lng: 11.2558 },
  Kyoto: { lat: 35.0116, lng: 135.7681 },
  // Within NEAR_KM of the placeholder pin (48, 10) a place with no known location gets.
  Augsburg: { lat: 48.3705, lng: 10.8978 },
};
const pointsAsked: string[] = [];
vi.mock("@/lib/ai/city-points", () => ({
  cityPointsFor: async (cities: string[]) => {
    pointsAsked.push(...cities);
    return cities.map((city) => POINTS[city] ?? null);
  },
}));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }) }));
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({ logApiCall: async (row: Record<string, unknown>) => void logged.push(row) }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));

let allowed = true;
vi.mock("@/lib/api-gateway/api-control", () => ({ checkApiAccess: async () => ({ allowed }) }));

const google = vi.fn(async () =>
  Response.json({ status: "OK", results: [{ place_id: "ChIJx", name: "Time Out Market", types: ["food"], photos: [{ photo_reference: "r".repeat(40) }] }] }),
);
vi.stubGlobal("fetch", google);

const { POST } = await import("./route");
const search = (query: string) =>
  POST(new NextRequest("http://localhost/api/activities/search", { method: "POST", body: JSON.stringify({ destination: "Lisbon", query, limit: 8 }) }));

const suggest = async (destination: string) => {
  const res = await POST(
    new NextRequest("http://localhost/api/activities/search", { method: "POST", body: JSON.stringify({ destination, query: "", limit: 8, includeGoogle: false }) })
  );
  return ((await res.json()).results as Array<{ name: string }>).map((r) => r.name);
};
const row = (name: string, at: { lat: number; lng: number } | null, type = "attraction") => ({
  row_key: name,
  trip_id: "t",
  name,
  type,
  similarity: 1,
  ...(at ? { coordinates: at } : {}),
});

beforeEach(() => {
  localRows = [];
  logged.length = 0;
  rpcArgs.length = 0;
  pointsAsked.length = 0;
  google.mockClear();
  allowed = true;
});

describe("POST /api/activities/search", () => {
  it("doesn't ask Google past the daily limit, and still answers from the trips we know", async () => {
    allowed = false;
    localRows = [];
    const res = await search("time out market");
    expect(res.status).toBe(200);
    expect(google).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("logs the paid Google search it falls back to", async () => {
    const res = await search("time out market");
    expect((await res.json()).source).toBe("hybrid");
    expect(google).toHaveBeenCalledTimes(1);
    expect(logged).toEqual([
      expect.objectContaining({ apiName: "google_places_search", endpoint: "maps/api/place/textsearch (add activity, legacy)", status: 200, costUsd: 0.032 }),
    ]);
  });

  it("logs nothing when the trips we know answer", async () => {
    localRows = ["A", "B", "C"].map((name, i) => ({ row_key: `k${i}`, trip_id: "t", name, type: "food", similarity: 1 }));
    await search("market");
    expect(google).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });
});

/**
 * The trips we know match a place by its name only, loosely: "Florence" finds
 * a theatre at Florenc, in Prague. Where the cities table knows the place, a
 * suggestion must be pinned near it; rides and stays are never suggestions.
 */
describe("suggestions from the trips we know", () => {
  const uffizi = row("Uffizi Gallery", { lat: 43.7678, lng: 11.2553 });
  const pisa = row("Leaning Tower of Pisa", { lat: 43.7228, lng: 10.3966 }); // a day trip, ~70 km
  const prague = row("Black Light Theatre", { lat: 50.0903, lng: 14.4396 }); // Florenc, Prague

  it("offers places near the city asked, not a namesake's elsewhere", async () => {
    localRows = [prague, uffizi, pisa];
    expect(await suggest("Florence")).toEqual(["Uffizi Gallery", "Leaning Tower of Pisa"]);
    expect(pointsAsked).toEqual(["Florence"]);
  });

  it("finds the city by the destination's first part", async () => {
    localRows = [row("Fushimi Inari", { lat: 34.9671, lng: 135.7727 }), prague];
    expect(await suggest("Kyoto, Japan")).toEqual(["Fushimi Inari"]);
    expect(pointsAsked).toEqual(["Kyoto"]);
  });

  it("leaves out a place with no real pin where the city is known", async () => {
    const cathedral = row("Augsburg Cathedral", { lat: 48.3727, lng: 10.8963 });
    localRows = [row("Somewhere", null), row("Placeholder", { lat: 48.0, lng: 10.0 }), cathedral];
    expect(await suggest("Augsburg")).toEqual(["Augsburg Cathedral"]);
  });

  it("keeps every place where the city isn't known, as before", async () => {
    localRows = [prague, row("Somewhere", null)];
    expect(await suggest("Côte d'Azur")).toEqual(["Black Light Theatre", "Somewhere"]);
  });

  it("never suggests a ride or a stay", async () => {
    localRows = [
      row("Train to Vienna", null, "transport"),
      row("Travel to Nara", null, "travel"),
      row("Check-in at Hotel Imago", null, "accommodation"),
      row("Prater", null, "attraction"),
    ];
    expect(await suggest("Vienna")).toEqual(["Prater"]);
  });

  it("asks the trips we know for more than it shows, so near places can fill the list", async () => {
    await suggest("Florence");
    expect(rpcArgs).toEqual([expect.objectContaining({ dest: "Florence", lim: 24 })]);
  });
});
