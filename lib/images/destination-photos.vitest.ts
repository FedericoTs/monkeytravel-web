/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A destination's Wikimedia photos come from the shared cache, or are found and
 * stored once. A destination without photos is remembered for a while; a
 * failure is not, so it is tried again. New lookups are capped per hour.
 */

const build = vi.fn();
vi.mock("@/lib/images/wikimedia", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wikimedia")>()),
  buildDestinationPhotos: (...a: unknown[]) => build(...a),
}));
const allowed = vi.fn();
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: allowed(), remaining: 1 }) }) }));
vi.mock("@/lib/api-gateway", () => ({ logApiCall: vi.fn(async () => {}) }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));

let cachedRow: { data: unknown } | null;
const upserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/cache-admin", () => ({
  cacheAdminDb: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        maybeSingle: async () => ({ data: cachedRow, error: null }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));

const { destinationPhotos } = await import("./destination-photos");
const request = new NextRequest("http://localhost/api/places?destination=Lisbon");
const photos = { cover: "/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-1920.jpg?a=X&l=CC0&f=X.jpg", gallery: [] };

beforeEach(() => {
  cachedRow = null;
  upserts.length = 0;
  build.mockReset();
  allowed.mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("destinationPhotos", () => {
  it("answers from the cache without looking anything up", async () => {
    cachedRow = { data: photos };
    expect(await destinationPhotos("Lisbon", request)).toEqual(photos);
    expect(build).not.toHaveBeenCalled();
  });

  it("sends a destination remembered as having no photos to the caller's own source", async () => {
    cachedRow = { data: { none: true } };
    expect(await destinationPhotos("Holmes County, Ohio", request)).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });

  it("finds and stores a new destination once, for a year", async () => {
    build.mockResolvedValue(photos);
    expect(await destinationPhotos("Lisbon", request)).toEqual(photos);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ cache_type: "wikimedia_destination", data: photos });
    const days = (Date.parse(String(upserts[0].expires_at)) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
  });

  it("remembers a destination without photos for a month", async () => {
    build.mockResolvedValue(null);
    expect(await destinationPhotos("Holmes County, Ohio", request)).toBeNull();
    expect(upserts[0]).toMatchObject({ data: { none: true } });
    expect(Math.round((Date.parse(String(upserts[0].expires_at)) - Date.now()) / 86_400_000)).toBe(30);
  });

  it("does not remember a failure, so the next request tries again", async () => {
    build.mockRejectedValue(new Error("commons.wikimedia.org answered 503"));
    expect(await destinationPhotos("Lisbon", request)).toBeNull();
    expect(upserts).toHaveLength(0);
  });

  it("looks nothing up past the hourly cap", async () => {
    allowed.mockReturnValue(false);
    expect(await destinationPhotos("Lisbon", request)).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });
});

describe("destinationPhotos for a trip, near its stops", () => {
  const SEOUL_TRIP = { lat: 37.55, lng: 126.99, km: 12 };
  const lake = { ...photos, at: { lat: 50.33, lng: -92.25 } };
  const seoul = { cover: "/api/images/wikimedia/bbbbbbbbbbbbbbbbbbbb-1920.jpg?a=Y&l=CC0&f=Seoul.jpg", gallery: [], at: { lat: 37.5667, lng: 126.9783 } };

  it("gives a stored photo of the place near the trip", async () => {
    cachedRow = { data: seoul };
    expect(await destinationPhotos("Seul", request, SEOUL_TRIP)).toEqual(seoul);
    expect(build).not.toHaveBeenCalled();
  });

  it("gives none for a stored photo of another place of the same name, and keeps it stored", async () => {
    cachedRow = { data: lake };
    expect(await destinationPhotos("Seul", request, SEOUL_TRIP)).toBeNull();
    expect(build).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
    // Asked without a trip, it is still the destination's photo.
    expect(await destinationPhotos("Seul", request)).toEqual(lake);
  });

  it("looks a photo stored without its place up again for the trip, and stores what it finds with its place", async () => {
    cachedRow = { data: photos };
    build.mockResolvedValue(seoul);
    expect(await destinationPhotos("Seul", request, SEOUL_TRIP)).toEqual(seoul);
    expect(build).toHaveBeenCalledWith("Seul", expect.anything(), SEOUL_TRIP);
    expect(upserts[0]).toMatchObject({ data: seoul });
  });

  it("gives none when that finds nothing near the trip, and keeps the stored photo for everyone else", async () => {
    cachedRow = { data: photos };
    build.mockResolvedValue(null);
    expect(await destinationPhotos("Seul", request, SEOUL_TRIP)).toBeNull();
    expect(upserts).toEqual([]);
  });

  it("stores a new destination's photo with its place", async () => {
    build.mockResolvedValue(seoul);
    expect(await destinationPhotos("Seoul, South Korea", request, SEOUL_TRIP)).toEqual(seoul);
    expect(upserts[0]).toMatchObject({ data: seoul });
  });
});

describe("readNear", () => {
  it("reads where a trip is from the query: its middle and how far its stops spread", async () => {
    const { readNear } = await import("./destination-photos");
    expect(readNear("37.5500,126.9900,12")).toEqual({ lat: 37.55, lng: 126.99, km: 12 });
    for (const bad of [null, "", "37.5,126.9", "91,0,5", "0,181,5", "a,b,c", "37,126,-1", "37,126,20001"]) expect(readNear(bad), String(bad)).toBeUndefined();
  });
});

describe("destinationPhotos for a trip, when new lookups are capped", () => {
  it("still gives a photo stored before places were kept, as before", async () => {
    cachedRow = { data: photos };
    allowed.mockReturnValue(false);
    expect(await destinationPhotos("Seul", request, { lat: 37.55, lng: 126.99, km: 12 })).toEqual(photos);
    expect(build).not.toHaveBeenCalled();
  });
});
