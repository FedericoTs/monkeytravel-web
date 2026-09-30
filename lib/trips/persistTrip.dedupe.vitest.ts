/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertTrip, type PersistInput } from "./persistTrip";

/**
 * insert_trip_dedup hands back a row with the same title and start date saved
 * in the last minute instead of inserting. That row used to keep its old
 * content, so a second plan made within the minute was reported saved and lost.
 */

function fakeSupabase(reused: boolean) {
  const updates: Array<{ id: unknown; fields: Record<string, unknown> }> = [];
  const client = {
    rpc: () => ({ single: async () => ({ data: { trip_id: "trip-1", reused }, error: null }) }),
    from: () => ({
      update: (fields: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          updates.push({ id, fields });
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as never, updates };
}

const INPUT = {
  itinerary: {
    destination: { name: "Lisbon", description: "Hills and trams", weather_note: "", best_for: [] },
    days: [
      { day_number: 1, activities: [] },
      { day_number: 2, activities: [] },
    ],
    trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
    booking_links: {},
  },
  formState: {
    destination: "Lisbon, Portugal",
    startDate: "2026-10-21",
    endDate: "2026-10-25",
    derivedInterests: [],
    travelStyle: "classic",
  },
} as unknown as PersistInput;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});

describe("insertTrip when the dedupe reuses a row", () => {
  it("writes this plan into the reused row, leaving sharing and status alone", async () => {
    const { client, updates } = fakeSupabase(true);
    const result = await insertTrip(client, INPUT, "user-1");
    expect(result.tripId).toBe("trip-1");
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("trip-1");
    expect(updates[0].fields).toMatchObject({ end_date: "2026-10-25", description: "Hills and trams" });
    expect((updates[0].fields.itinerary as unknown[]).length).toBe(2);
    expect(updates[0].fields).not.toHaveProperty("visibility");
    expect(updates[0].fields).not.toHaveProperty("status");
    expect(updates[0].fields).not.toHaveProperty("user_id");
  });

  it("does not touch the row it just inserted", async () => {
    const { client, updates } = fakeSupabase(false);
    await insertTrip(client, INPUT, "user-1");
    expect(updates).toEqual([]);
  });
});
