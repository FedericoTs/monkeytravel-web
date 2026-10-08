import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A dead destination hero used to heal every gallery tile to the place's first
 * photo. Tiles now carry their photo's index (i=) and the heal fetches that
 * photo. The real fetchPlacePhoto runs; Google's Details and media endpoints
 * are mocked through fetch.
 */

// The route and lib/images/activity read the key at import time.
vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

vi.mock("@/lib/api-gateway", () => ({ logApiCall: vi.fn(async () => {}) }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
let cachedRow: Record<string, unknown> | null = null;
const cacheWrites: unknown[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: cachedRow }) }) }),
      update: (row: unknown) => {
        cacheWrites.push(row);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import { GET } from "./route";

const PLACE = "ChIJplace123";
// Real photo names are long tokens; fetchPlacePhoto skips anything under 200 chars.
const photo = (n: number) => `places/${PLACE}/photos/P${n}${"x".repeat(250)}`;
const DEAD = `places/${PLACE}/photos/DeadTile`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const google = vi.fn(async (url: string) => {
  if (url === `https://places.googleapis.com/v1/places/${PLACE}`) {
    return new Response(JSON.stringify({ photos: [0, 1, 2, 3, 4].map((n) => ({ name: photo(n) })) }), { status: 200 });
  }
  if (url.includes("/photos/DeadTile/media")) return new Response("{}", { status: 400 });
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
});

const tile = (extra: string) =>
  GET(
    new NextRequest(`https://monkeytravel.app/api/places/photo?name=${encodeURIComponent(DEAD)}&w=200&h=150${extra}`, {
      headers: { "user-agent": BROWSER_UA },
    })
  );

/** Which photo's bytes the heal downloaded: the last media call. */
const healedPhoto = () => {
  const media = google.mock.calls.map(([url]) => url).filter((url) => url.includes("/media?"));
  return /\/photos\/(P\d)/.exec(media[media.length - 1] ?? "")?.[1];
};

beforeEach(() => {
  google.mockClear();
  cachedRow = null;
  cacheWrites.length = 0;
  vi.stubGlobal("fetch", google);
});
afterEach(() => vi.unstubAllGlobals());

describe("gallery heal picks distinct photos", () => {
  it("each tile heals to the photo at its own index", async () => {
    const healed: Array<string | undefined> = [];
    for (const i of [1, 2, 3]) {
      google.mockClear();
      const res = await tile(`&i=${i}`);
      expect(res.status).toBe(200);
      healed.push(healedPhoto());
    }
    expect(healed).toEqual(["P1", "P2", "P3"]);
  });

  it("a tile ignores the place's cached cover ref and never overwrites it", async () => {
    cachedRow = { photo_resource_name: photo(0), photo_url: "/api/places/photo?name=x", updated_at: new Date().toISOString() };
    const res = await tile("&i=2");
    expect(res.status).toBe(200);
    expect(healedPhoto()).toBe("P2");
    await new Promise((r) => setTimeout(r, 0));
    expect(cacheWrites).toHaveLength(0);
  });

  it("without an index the heal is unchanged: the first photo, and the cache is repaired", async () => {
    const res = await tile("");
    expect(res.status).toBe(200);
    expect(healedPhoto()).toBe("P0");
    await new Promise((r) => setTimeout(r, 0));
    expect(cacheWrites).toEqual([expect.objectContaining({ photo_resource_name: photo(0) })]);
  });
});
