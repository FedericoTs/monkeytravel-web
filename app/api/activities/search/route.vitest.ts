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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async () => ({ data: localRows, error: null }),
  }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }) }));
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({ logApiCall: async (row: Record<string, unknown>) => void logged.push(row) }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));

const google = vi.fn(async () =>
  Response.json({ status: "OK", results: [{ place_id: "ChIJx", name: "Time Out Market", types: ["food"], photos: [{ photo_reference: "r".repeat(40) }] }] }),
);
vi.stubGlobal("fetch", google);

const { POST } = await import("./route");
const search = (query: string) =>
  POST(new NextRequest("http://localhost/api/activities/search", { method: "POST", body: JSON.stringify({ destination: "Lisbon", query, limit: 8 }) }));

beforeEach(() => {
  localRows = [];
  logged.length = 0;
  google.mockClear();
});

describe("POST /api/activities/search", () => {
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
