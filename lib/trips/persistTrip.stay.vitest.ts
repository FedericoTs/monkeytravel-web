import { describe, expect, it } from "vitest";
import { insertTrip, type PersistInput } from "./persistTrip";

/**
 * A plan made around where the traveller is staying is saved with it, as
 * trip_meta.stay, so what the plan was built around stays with the trip.
 */

function fakeSupabase() {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
  };
  return { client: client as never, rows };
}

const input = (stay: unknown) =>
  ({
    itinerary: {
      destination: { name: "Lisbon, Portugal", description: "", weather_note: "", best_for: [] },
      days: [{ day_number: 1, activities: [{ id: "a0", name: "A0", type: "attraction" }] }],
      trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
      booking_links: {},
    },
    formState: { destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-12", derivedInterests: [], travelStyle: "classic", stay },
  }) as unknown as PersistInput;

const meta = (row: Record<string, unknown>) => (row.trip_meta ?? {}) as Record<string, unknown>;

describe("where they're staying, on the saved trip", () => {
  it("is written with the trip", async () => {
    const stay = { name: "Memmo Alfama", coordinates: { lat: 38.7111, lng: -9.1306 } };
    const { client, rows } = fakeSupabase();
    await insertTrip(client, input(stay), "user-1");
    expect(meta(rows[0]).stay).toEqual(stay);
  });

  it("leaves the key out when they didn't say", async () => {
    for (const stay of [null, undefined]) {
      const { client, rows } = fakeSupabase();
      await insertTrip(client, input(stay), "user-1");
      expect(meta(rows[0])).not.toHaveProperty("stay");
    }
  });
});
