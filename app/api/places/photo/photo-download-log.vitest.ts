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
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const photoRequest = (query: string, userAgent: string | null = BROWSER_UA) =>
  new NextRequest(`https://monkeytravel.app/api/places/photo?${query}`, {
    headers: userAgent ? { "user-agent": userAgent } : {},
  });
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
      metadata: { place: "ChIJplace123", photo: expect.stringMatching(/^[0-9a-f]{12}$/), w: 600, h: 400 },
    });
  });

  it("repeat downloads of one photo share an id, another photo gets another", async () => {
    for (let i = 0; i < 4; i++) upstream.mockResolvedValueOnce(jpeg());
    await GET(photoRequest(`name=${encodeURIComponent(NAME)}&w=600&h=400`));
    await GET(photoRequest(`name=${encodeURIComponent(NAME)}&w=600&h=400`));
    await GET(photoRequest(`name=${encodeURIComponent("places/ChIJplace123/photos/Other")}&w=600&h=400`));
    await GET(photoRequest(`ref=${"B".repeat(40)}&w=400`));
    const ids = logged.map((r) => (r.metadata as { photo: string }).photo);
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(3);
    expect(JSON.stringify(logged)).not.toContain("AbCdEf");
  });

  it("a legacy photo reference is logged the same way", async () => {
    upstream.mockResolvedValueOnce(jpeg());
    await GET(photoRequest(`ref=${"A".repeat(40)}&w=400`));
    expect(logged[0]).toMatchObject({
      apiName: "google_places_photo",
      endpoint: "maps/api/place/photo (render, legacy ref)",
      costUsd: 0.007,
      metadata: { legacy: true, photo: expect.stringMatching(/^[0-9a-f]{12}$/), w: 400 },
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
    // Both rows carry the requested photo's id, so repeated heals of one URL add up.
    const [failed, healed] = logged.map((r) => (r.metadata as { photo: string }).photo);
    expect(healed).toBe(failed);
  });

  it("nothing is logged when no download is attempted", async () => {
    const res = await GET(photoRequest("name=not-a-photo-name"));
    expect(res.status).toBe(400);
    expect(logged).toHaveLength(0);
  });
});

describe("automation gets the curated image instead of a Google download", () => {
  const query = `name=${encodeURIComponent(NAME)}&w=600&h=400`;

  it.each([
    ["a crawler", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["a headless browser", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/141.0.0.0 Safari/537.36"],
    ["the pinned automation fleet", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"],
    ["a request with no user-agent", null],
  ])("%s gets an uncached 307 to the curated image and Google is never called", async (_who, userAgent) => {
    const res = await GET(photoRequest(query, userAgent));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://images.pexels.com/fallback.jpg");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
    expect(logged).toHaveLength(0);
  });

  it("a browser follows the existing path: Google download, cached for a year", async () => {
    upstream.mockResolvedValueOnce(jpeg());
    const res = await GET(photoRequest(query));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=2592000, s-maxage=31536000, immutable");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][0]).toBe(`https://places.googleapis.com/v1/${NAME}/media?maxHeightPx=400&maxWidthPx=600`);
    expect(logged).toHaveLength(1);
  });

  it("the OG card renderer (og=1) follows the existing path despite its library user-agent", async () => {
    upstream.mockResolvedValueOnce(jpeg());
    const res = await GET(photoRequest(`${query}&og=1`, "undici"));
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
