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
const FRESH = "/api/places/photo?name=places%2Fx%2Fphotos%2Fq&w=600&h=400";
const BROKEN = "https://maps.googleapis.com/maps/api/place/photo?photo_reference=old";
const STOCK = "https://images.pexels.com/photos/1/a.jpeg";

type PlacesAnswer = { data: Array<{ place_id: string; photo_url: string }>; error: null };
let placesRead: () => Promise<PlacesAnswer>;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: () => placesRead() }) }) }),
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
  placesRead = async () => ({ data: [], error: null });
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

  // Which stops show a stand-in is known before the place photos come back,
  // so neither read waits for the other.
  it("asks for the place photos and the found photos together, and for the stand-ins only", async () => {
    let answerPlaces: (answer: PlacesAnswer) => void = () => {};
    placesRead = () => new Promise((resolve) => (answerPlaces = resolve));
    const shown = refreshTripItinerary(trip(), "Prague, Czechia");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cachedLandmarkPhotos).toHaveBeenCalledTimes(1);
    expect([...cachedLandmarkPhotos.mock.calls[0][0]].sort()).toEqual(
      [normalizeActivityKey("Charles Bridge", "Prague, Czechia"), normalizeActivityKey("Lokál", "Prague, Czechia")].sort(),
    );
    answerPlaces({ data: [{ place_id: "x", photo_url: FRESH }], error: null });
    expect((await shown).flatMap((d) => d.activities.map((a) => a.image_url))).toEqual([WIKI, FRESH, STOCK, WIKI]);
  });

  it("asks for no found photo when every stop has a real one", async () => {
    const stored = [{ day_number: 1, activities: [{ id: "a2", name: "Prague Castle", image_url: GOOGLE }] }] as unknown as ItineraryDay[];
    expect((await refreshTripItinerary(stored, "Prague, Czechia"))[0].activities[0].image_url).toBe(GOOGLE);
    expect(cachedLandmarkPhotos).not.toHaveBeenCalled();
  });

  // The found photos are kept by name: two stops can share one.
  it("keeps a real photo on a stop whose namesake shows a stand-in", async () => {
    const stored = [
      { day_number: 1, activities: [{ id: "a1", name: "Charles Bridge", image_url: STOCK }] },
      { day_number: 2, activities: [{ id: "a2", name: "Charles Bridge", image_url: GOOGLE }] },
    ] as unknown as ItineraryDay[];
    const shown = await refreshTripItinerary(stored, "Prague, Czechia");
    expect(shown.flatMap((d) => d.activities.map((a) => a.image_url))).toEqual([WIKI, GOOGLE]);
  });

  it("gives a picture the refresh had to blank its found photo, or leaves it blank", async () => {
    const stored = () => [{ day_number: 1, activities: [{ id: "a1", name: "Charles Bridge", image_url: BROKEN }] }] as unknown as ItineraryDay[];
    expect((await refreshTripItinerary(stored(), "Prague, Czechia"))[0].activities[0].image_url).toBe(WIKI);
    cached.clear();
    expect((await refreshTripItinerary(stored(), "Prague, Czechia"))[0].activities[0].image_url).toBeNull();
  });
});
