/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Enrichment runs right after every save. A trip still without a cover then
 * gets one from the place photos this run wrote, so no trip reaches My Trips
 * bare. The write is conditional on the column being empty: a cover set in the
 * meantime (the browser's cover lookup, the trip page) always wins.
 */

const TOWER = "/api/places/photo?name=places%2Ftower%2Fphotos%2Fp&w=600&h=400&t=attraction";
const enriched = [{ day_number: 1, activities: [{ id: "a1", name: "Tower", type: "attraction", image_url: TOWER }] }];

let trip: Record<string, unknown>;
let outcome: Record<string, unknown>;
const writes: Array<{ fields: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = [];
const capture = vi.fn(async (_user: string, _event: string, _props: Record<string, unknown>) => {});

const db = {
  from: () => ({
    update: (fields: Record<string, unknown>) => {
      const write = { fields, filters: [] as Array<[string, string, unknown]> };
      writes.push(write);
      const q = {
        eq: (c: string, v: unknown) => (write.filters.push(["eq", c, v]), q),
        is: (c: string, v: unknown) => (write.filters.push(["is", c, v]), q),
        select: async () => ({ data: [{ id: "trip-1" }], error: null }),
      };
      return q;
    },
  }),
};

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "user-1" }, supabase: db, errorResponse: null }),
  verifyTripOwnership: async () => ({ trip, errorResponse: null }),
}));
vi.mock("@/lib/images/activity", () => ({ SAVE_TIME_PAID_LOOKUPS: 10 }));
vi.mock("@/lib/images/enrichTrip", () => ({ enrichTripRecord: async () => outcome }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: (...args: [string, string, Record<string, unknown>]) => capture(...args) }));

import { POST } from "./route";

const run = () => POST(new NextRequest("https://monkeytravel.app/api/trips/trip-1/enrich-photos", { method: "POST" }), { params: Promise.resolve({ id: "trip-1" }) });

beforeEach(() => {
  writes.length = 0;
  capture.mockClear();
  trip = { id: "trip-1", user_id: "user-1", title: "Lisbon Trip", itinerary: [], trip_meta: {}, itinerary_version: 0, cover_image_url: null };
  outcome = { skipped: null, before: { real: 0, total: 1 }, after: { real: 1, total: 1 }, itinerary: enriched };
});

describe("enrich-photos tells the opened trip page what it found", () => {
  it("lists the place photos by activity, for the page to show without a reload", async () => {
    const res = await run();
    expect((await res.json()).photos).toEqual({ a1: TOWER });
  });
});

describe("enrich-photos gives a cover-less trip its cover", () => {
  it("writes the first sight's photo at cover size, only while the column is empty", async () => {
    await run();
    expect(writes).toHaveLength(1);
    const cover = new URLSearchParams(String(writes[0].fields.cover_image_url).split("?")[1]);
    expect([cover.get("name"), cover.get("w"), cover.get("h")]).toEqual(["places/tower/photos/p", "1920", "1200"]);
    expect(writes[0].filters).toEqual([["eq", "id", "trip-1"], ["is", "cover_image_url", null]]);
    expect(capture.mock.calls[0][2]).toMatchObject({ cover_set: true });
  });

  it("leaves a trip that has a cover alone", async () => {
    trip.cover_image_url = "/api/img/proxy/https%3A%2F%2Fimages.pexels.com%2Fa.jpg";
    await run();
    expect(writes).toEqual([]);
    expect(capture.mock.calls[0][2]).toMatchObject({ cover_set: false });
  });

  it("writes nothing when the run wrote no itinerary or found no place photo", async () => {
    outcome = { ...outcome, itinerary: undefined };
    await run();
    outcome = { ...outcome, itinerary: [{ day_number: 1, activities: [{ id: "a1", type: "attraction", image_url: "https://images.pexels.com/photos/1/a.jpeg" }] }] };
    await run();
    expect(writes).toEqual([]);
  });
});
