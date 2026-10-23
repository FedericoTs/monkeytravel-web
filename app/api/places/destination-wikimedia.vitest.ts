/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The destination hero asks this route for a cover and a gallery. Wikimedia
 * photos come first: stored once and free to show, where Google's are paid on
 * every view. Google answers only for a destination Wikimedia has no photo of.
 */

const destinationPhotos = vi.fn();
vi.mock("@/lib/images/destination-photos", () => ({ destinationPhotos: (...a: unknown[]) => destinationPhotos(...a) }));
const createClient = vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("@/lib/supabase/cache-admin", () => ({ cacheAdminDb: () => null }));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: false, message: "Places disabled in this test" }),
  logApiCall: vi.fn(),
  ApiBlockedError: class extends Error {},
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: vi.fn(), incrementUsage: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({ getAuthenticatedUser: vi.fn() }));

const { GET } = await import("./route");
const get = (destination: string) => GET(new NextRequest(`http://localhost/api/places?destination=${encodeURIComponent(destination)}`));
const fetchSpy = vi.fn();

beforeEach(() => {
  destinationPhotos.mockReset();
  createClient.mockClear();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("GET /api/places?destination=", () => {
  it("answers with the Wikimedia cover and gallery, without touching Google", async () => {
    destinationPhotos.mockResolvedValue({
      cover: "/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-1920.jpg?a=X&l=CC0&f=A.jpg",
      gallery: ["/api/images/wikimedia/bbbbbbbbbbbbbbbbbbbb-330.jpg?a=Y&l=CC0&f=B.jpg"],
    });
    const res = await get("Medellín, Colombia");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverImageUrl).toBe("/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-1920.jpg?a=X&l=CC0&f=A.jpg");
    expect(body.galleryPhotos).toEqual([
      { url: "/api/images/wikimedia/bbbbbbbbbbbbbbbbbbbb-330.jpg?a=Y&l=CC0&f=B.jpg", thumbnailUrl: "/api/images/wikimedia/bbbbbbbbbbbbbbbbbbbb-330.jpg?a=Y&l=CC0&f=B.jpg" },
    ]);
    expect(body.source).toBe("wikimedia");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("gives the planner's preview no photo rather than Google's when Wikimedia has none", async () => {
    destinationPhotos.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/places?destination=Holmes%20County%2C%20Ohio&free=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ coverImageUrl: null, galleryPhotos: [], source: "none" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("goes on to Google when Wikimedia has no photo of the destination", async () => {
    destinationPhotos.mockResolvedValue(null);
    const res = await get("Holmes County, Ohio");
    // Google is switched off in this test, so the Google path answers 503.
    expect(res.status).toBe(503);
    expect(createClient).toHaveBeenCalled();
  });
});
