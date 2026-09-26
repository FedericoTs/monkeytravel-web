import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Every Google photo download is logged and priced. They were the one Google
 * call nobody logged (2026-09-26), and they were most of the Google bill: ~400-480
 * CDN misses a day, each a billed "Place Details Photos" request.
 */

// The route reads the key at import time, and imports are hoisted above plain
// statements: set it in the hoisted block.
vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({
  logApiCall: vi.fn(async (row: Record<string, unknown>) => {
    logged.push(row);
  }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
// The cached row for the place: nothing reusable, so a dead ref pays one heal.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
const fetchPlacePhoto = vi.fn();
vi.mock("@/lib/images/activity", () => ({
  curatedFor: () => "https://images.pexels.com/fallback.jpg",
  readActivityTypeHint: () => "",
  fetchPlacePhoto: (...args: unknown[]) => fetchPlacePhoto(...args),
}));

import { GET } from "./route";

const NAME = "places/ChIJplace123/photos/AbCdEf";
const photoRequest = (query: string) => new NextRequest(`https://monkeytravel.app/api/places/photo?${query}`);
const jpeg = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });

const upstream = vi.fn();
beforeEach(() => {
  logged.length = 0;
  upstream.mockReset();
  fetchPlacePhoto.mockReset();
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => vi.unstubAllGlobals());

describe("photo downloads are logged and priced", () => {
  it("a download logs one row at Google's per-photo price, with the place and size", async () => {
    upstream.mockResolvedValueOnce(jpeg());
    const res = await GET(photoRequest(`name=${encodeURIComponent(NAME)}&w=600&h=400`));
    expect(res.status).toBe(200);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      apiName: "google_places_photo",
      endpoint: "places/{id}/photos/{photo}/media (render)",
      status: 200,
      cacheHit: false,
      costUsd: 0.007,
      exactCost: true,
      metadata: { place: "ChIJplace123", w: 600, h: 400 },
    });
  });

  it("a legacy photo reference is logged the same way", async () => {
    upstream.mockResolvedValueOnce(jpeg());
    await GET(photoRequest(`ref=${"A".repeat(40)}&w=400`));
    expect(logged[0]).toMatchObject({
      apiName: "google_places_photo",
      endpoint: "maps/api/place/photo (render, legacy ref)",
      costUsd: 0.007,
      metadata: { legacy: true, w: 400 },
    });
  });

  it("an expired name logs the failed download at $0, then the heal's download at full price", async () => {
    upstream
      .mockResolvedValueOnce(new Response("{}", { status: 400 })) // the dead name
      .mockResolvedValueOnce(jpeg()); // the fresh one
    fetchPlacePhoto.mockResolvedValueOnce({
      photo_resource_name: "places/ChIJplace123/photos/FreshOne",
      photo_url: "/api/places/photo?name=places%2FChIJplace123%2Fphotos%2FFreshOne&w=600&h=400",
    });
    const res = await GET(photoRequest(`name=${encodeURIComponent(NAME)}&w=600&h=400`));
    expect(res.status).toBe(200);
    expect(logged.map((r) => [r.endpoint, r.status, r.costUsd])).toEqual([
      ["places/{id}/photos/{photo}/media (render)", 400, 0],
      ["places/{id}/photos/{photo}/media (render self-heal)", 200, 0.007],
    ]);
  });

  it("nothing is logged when no download is attempted", async () => {
    const res = await GET(photoRequest("name=not-a-photo-name"));
    expect(res.status).toBe(400);
    expect(logged).toHaveLength(0);
  });
});
