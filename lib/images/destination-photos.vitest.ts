/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A destination's Wikimedia photos come from the shared cache, or are found and
 * stored once. A destination without photos is remembered for a while; a
 * failure is not, so it is tried again. New lookups are capped per hour.
 */

const build = vi.fn();
vi.mock("@/lib/images/wikimedia", () => ({ buildDestinationPhotos: (...a: unknown[]) => build(...a) }));
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
