import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { keepStoredPlacePhotos } from "./keep-place-photos";

/**
 * A page that loaded before the save-time photo enrichment landed must not put
 * the curated fallbacks back over the real place photos on its next save.
 */

const photo = (name: string) => `/api/places/photo?ref=${name}`;
const curated = "https://images.example/curated.jpg";
const trip = (acts: Array<Record<string, unknown>>) => [{ day_number: 1, date: "2027-01-01", activities: acts }] as unknown as ItineraryDay[];

describe("keepStoredPlacePhotos", () => {
  it("keeps the stored place photo when the page only has the fallback for the same activity", () => {
    const stored = trip([{ id: "a1", name: "Alpha", image_url: photo("Alpha") }, { id: "a2", name: "Bravo", image_url: photo("Bravo") }]);
    // The page's copy: loaded before enrichment, then Bravo was moved and Alpha deleted.
    const incoming = trip([{ id: "a2", name: "Bravo", image_url: curated, start_time: "18:00" }]);
    const out = keepStoredPlacePhotos(incoming, stored);
    expect(out.kept).toBe(1);
    expect(out.itinerary[0].activities).toEqual([{ id: "a2", name: "Bravo", image_url: photo("Bravo"), start_time: "18:00" }]);
  });

  it("never puts a photo on a different place that reuses the id (a replaced activity)", () => {
    const stored = trip([{ id: "a1", name: "Alpha", image_url: photo("Alpha") }]);
    const incoming = trip([{ id: "a1", name: "Something else", image_url: curated }]);
    expect(keepStoredPlacePhotos(incoming, stored)).toMatchObject({ kept: 0, itinerary: incoming });
  });

  it("leaves a place photo sent by the page, new activities, and odd shapes alone", () => {
    const stored = trip([{ id: "a1", name: "Alpha", image_url: photo("old") }]);
    const incoming = [
      { day_number: 1, date: "2027-01-01", activities: [{ id: "a1", name: "Alpha", image_url: photo("new") }, { id: "n1", name: "New", image_url: curated }, null, 7] },
      null,
      { day_number: 3, date: "2027-01-03" },
    ] as unknown as ItineraryDay[];
    const out = keepStoredPlacePhotos(incoming, stored);
    expect(out.kept).toBe(0);
    expect(out.itinerary).toEqual(incoming);
    expect(keepStoredPlacePhotos(incoming, null).itinerary).toBe(incoming);
  });
});
