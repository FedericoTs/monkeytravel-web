/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A shared or public trip shows the Wikimedia photos found for its places
 * since it was planned, in place of its stand-in images: for that read only,
 * never over a real photo, and nothing changes when the cache can't be read.
 */

const WIKI = "/api/images/wikimedia/abc-500.jpg?a=X&l=CC0&f=Y.jpg";
const GOOGLE = "/api/places/photo?name=places%2Fx%2Fphotos%2Fp&w=600&h=400";
const STOCK = "https://images.pexels.com/photos/1/a.jpeg";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
}));
let cached: Map<string, string | null>;
let failing = false;
const cachedLandmarkPhotos = vi.fn(async (keys: string[]) => {
  if (failing) throw new Error("cache down");
  return new Map([...cached].filter(([key]) => keys.includes(key)));
});
vi.mock("@/lib/images/landmark-photos", () => ({ cachedLandmarkPhotos: (keys: string[]) => cachedLandmarkPhotos(keys) }));

const { refreshTripItinerary } = await import("./refreshItineraryPhotos");
const { normalizeActivityKey } = await import("@/lib/images/activity");

const trip = () =>
  [
    {
      day_number: 1,
      activities: [
        { id: "a1", name: "Charles Bridge", image_url: STOCK },
        { id: "a2", name: "Prague Castle", image_url: GOOGLE },
        { id: "a3", name: "Lokál", image_url: STOCK },
      ],
    },
    { day_number: 2, activities: [{ id: "a4", name: "Charles Bridge" }] },
  ] as unknown as ItineraryDay[];

beforeEach(() => {
  cached = new Map([
    [normalizeActivityKey("Charles Bridge", "Prague, Czechia"), WIKI],
    [normalizeActivityKey("Prague Castle", "Prague, Czechia"), WIKI],
    [normalizeActivityKey("Lokál", "Prague, Czechia"), null],
  ]);
  failing = false;
  cachedLandmarkPhotos.mockClear();
});

describe("refreshTripItinerary with the trip's destination", () => {
  it("shows the photos found in place of stand-ins, never over a real photo", async () => {
    const stored = trip();
    const shown = await refreshTripItinerary(stored, "Prague, Czechia");
    expect(shown.flatMap((d) => d.activities.map((a) => a.image_url))).toEqual([WIKI, GOOGLE, STOCK, WIKI]);
    // The stored copy is not changed.
    expect(stored[0].activities[0].image_url).toBe(STOCK);
  });

  it("reads nothing without a destination, and shows the stand-ins when the cache can't be read", async () => {
    expect((await refreshTripItinerary(trip())).flatMap((d) => d.activities.map((a) => a.image_url))).toEqual([STOCK, GOOGLE, STOCK, undefined]);
    expect(cachedLandmarkPhotos).not.toHaveBeenCalled();
    failing = true;
    expect((await refreshTripItinerary(trip(), "Prague, Czechia"))[0].activities[0].image_url).toBe(STOCK);
  });
});
