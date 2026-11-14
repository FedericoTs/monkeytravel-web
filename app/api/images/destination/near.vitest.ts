/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A saved trip asks for its cover with where its stops are (`near`), so a
 * photo of another place with the destination's name is passed over. That
 * ask never takes, nor leaves, this instance's memory of the destination.
 */

const photosFor = vi.fn();
vi.mock("@/lib/images/destination-photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/images/destination-photos")>()),
  destinationPhotos: (...a: unknown[]) => photosFor(...a),
}));

const { GET } = await import("./route");
const get = async (query: string) => {
  const res = await GET(new NextRequest(`http://localhost/api/images/destination?${query}`));
  const body = await res.json();
  return (body.data ?? body) as { url?: string; source?: string };
};
const LAKE = { cover: "/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-1920.jpg?f=Lac%20Seul.jpg", gallery: [] };
const SEOUL = { cover: "/api/images/wikimedia/bbbbbbbbbbbbbbbbbbbb-1920.jpg?f=Seoul.jpg", gallery: [] };

beforeEach(() => {
  photosFor.mockReset();
  // No stock photo source in a test.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/images/destination with near", () => {
  it("passes where the trip is on to the photo lookup", async () => {
    photosFor.mockResolvedValue(SEOUL);
    expect(await get("destination=Seul&near=37.5500,126.9900,12")).toMatchObject({ url: SEOUL.cover, source: "wikimedia" });
    expect(photosFor).toHaveBeenCalledWith("Seul", expect.anything(), { lat: 37.55, lng: 126.99, km: 12 });
  });

  it("asks without it when the value is not a place", async () => {
    photosFor.mockResolvedValue(SEOUL);
    await get("destination=Gyeongju&near=somewhere");
    expect(photosFor).toHaveBeenCalledWith("Gyeongju", expect.anything(), undefined);
  });

  it("doesn't answer a trip from what this instance remembers of the destination, nor teach it", async () => {
    photosFor.mockResolvedValueOnce(LAKE);
    expect((await get("destination=Seulx")).url).toBe(LAKE.cover);
    // For the trip: no photo near it, so the stock source answers.
    vi.stubEnv("PEXELS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ photos: [{ src: { large: "https://images.pexels.com/photos/1/seoul.jpeg" } }] }) })));
    photosFor.mockResolvedValueOnce(null);
    expect((await get("destination=Seulx&near=37.5500,126.9900,12")).url).toBe("https://images.pexels.com/photos/1/seoul.jpeg");
    expect(photosFor).toHaveBeenCalledTimes(2);
    // A stock answer found for the trip isn't remembered for everyone else.
    expect((await get("destination=Seulx")).url).toBe(LAKE.cover);
    expect(photosFor).toHaveBeenCalledTimes(2);
  });
});
