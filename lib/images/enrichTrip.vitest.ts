// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * Photo enrichment on a trip read WITHOUT activity ids (trips stored before
 * ids were stamped at creation), while the trip page stores ids meanwhile.
 * The id-based merge found nothing to apply and the paid lookups were lost;
 * id-less activities are now matched by their place and name.
 */

vi.mock("@/lib/images/activity", () => ({
  SAVE_TIME_PAID_LOOKUPS: 8,
  fetchActivityImages: vi.fn(async (itinerary: ItineraryDay[]) => {
    for (const day of itinerary) for (const a of day.activities) a.image_url = `/api/places/photo?ref=${a.name}`;
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));

import { enrichTripRecord } from "./enrichTrip";

const curated = "https://images.example/curated.jpg";
const read: ItineraryDay[] = [
  { day_number: 1, date: "2027-01-01", activities: [{ name: "Alpha", image_url: curated }, { name: "Bravo", image_url: curated }] },
] as unknown as ItineraryDay[];

function fakeDb(row: { itinerary: ItineraryDay[]; itinerary_version: number; trip_meta: Record<string, unknown> }, pageStoresIdsFirst: boolean) {
  let stored = { ...row };
  let first = true;
  return {
    stored: () => stored,
    db: {
      from: () => ({
        update: (values: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const q = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v]);
              return q;
            },
            select: async () => {
              if (first && pageStoresIdsFirst) {
                first = false;
                // The trip page stored ids (and the version moved) during the lookups.
                stored = {
                  ...stored,
                  itinerary: stored.itinerary.map((d) => ({ ...d, activities: d.activities.map((a, i) => ({ ...a, id: `act_page${i}` })) })),
                  itinerary_version: stored.itinerary_version + 1,
                };
              }
              const v = filters.find(([c]) => c === "itinerary_version")?.[1];
              if (v !== stored.itinerary_version) return { data: [], error: null };
              stored = { ...stored, ...(values as object) } as typeof stored;
              return { data: [{ itinerary_version: stored.itinerary_version }], error: null };
            },
          };
          return q;
        },
        select: () => {
          const q = { eq: () => q, maybeSingle: async () => ({ data: { ...stored }, error: null }) };
          return q;
        },
      }),
    },
  };
}

describe("enrichTripRecord on an id-less trip", () => {
  it("still applies the photos when the page stored ids during the lookups", async () => {
    const start = { itinerary: structuredClone(read), itinerary_version: 0, trip_meta: {} };
    const { db, stored } = fakeDb(structuredClone(start), true);
    const out = await enrichTripRecord(db as never, { id: "t1", itinerary: structuredClone(read), trip_meta: {}, itinerary_version: 0 }, { maxPaidLookups: 8, respectCooldown: false });
    const acts = stored().itinerary[0].activities;
    expect(acts.map((a) => a.id)).toEqual(["act_page0", "act_page1"]); // the page's ids kept
    expect(acts.map((a) => a.image_url)).toEqual(["/api/places/photo?ref=Alpha", "/api/places/photo?ref=Bravo"]);
    expect(out.after.real).toBe(2);
  });

  it("does not put a photo on a different activity that took the same place", async () => {
    const start = { itinerary: structuredClone(read), itinerary_version: 0, trip_meta: {} };
    const { db, stored } = fakeDb(start, true);
    // Someone renamed Bravo before the page stored ids.
    (start.itinerary[0].activities[1] as { name: string }).name = "Charlie";
    await enrichTripRecord(db as never, { id: "t1", itinerary: structuredClone(read), trip_meta: {}, itinerary_version: 0 }, { maxPaidLookups: 8, respectCooldown: false });
    const acts = stored().itinerary[0].activities;
    expect(acts[0].image_url).toBe("/api/places/photo?ref=Alpha");
    expect(acts[1].image_url).toBe(curated);
  });
});
