/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { insertTrip, type PersistInput } from "./persistTrip";

/**
 * A new trip is stored with an id on every activity, because photos, crew asks and
 * votes refer to activities by id. Both of the wizard's saves come through here.
 */

function fakeClient() {
  const rows: Array<{ itinerary: Array<{ activities: Array<{ id?: string }> }> }> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: (typeof rows)[number] }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
  };
  return { client: client as never, rows };
}

const input = {
  itinerary: {
    destination: { name: "Lisbon", description: "", weather_note: "", best_for: [] },
    days: [{ day_number: 1, activities: [{ name: "Alfama", type: "attraction" }, { id: "act_kept", name: "Belem", type: "attraction" }] }],
    trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
    booking_links: {},
  },
  formState: { destination: "Lisbon, Portugal", startDate: "2026-10-21", endDate: "2026-10-25", derivedInterests: [], travelStyle: "classic" },
} as unknown as PersistInput;

describe("a new trip's activities", () => {
  it("are stored with ids: new ones where they had none, and the ones they had", async () => {
    const { client, rows } = fakeClient();
    await insertTrip(client, input, "user-1");
    const [given, kept] = rows[0].itinerary[0].activities;
    expect(given.id).toMatch(/^act_/);
    expect(kept.id).toBe("act_kept");
  });
});
