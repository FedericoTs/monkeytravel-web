/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { insertTrip, updateTrip, type PersistInput } from "./persistTrip";

/**
 * A saved trip records where it was first saved from: trip_meta.save_arm
 * (auto-save or the Save button) and wizard_mount_id, so a duplicate pair can
 * be told apart without forensics. A regenerate rewrites trip_meta from the
 * new plan, and used to erase both.
 */

function fakeSupabase(current: { trip_meta: unknown } | null, readError: unknown = null) {
  const rows: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current, error: readError }) }) }),
      update: (fields: Record<string, unknown>) => {
        updates.push(fields);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { client: client as never, rows, updates };
}

const input = (destination: string) =>
  ({
    itinerary: {
      destination: { name: destination, description: "", weather_note: "", best_for: [] },
      days: [{ day_number: 1, activities: [{ id: "a0", name: "A0", type: "attraction" }] }],
      trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
      booking_links: {},
    },
    formState: { destination, startDate: "2026-10-21", endDate: "2026-10-25", derivedInterests: [], travelStyle: "classic" },
  }) as unknown as PersistInput;

const meta = (fields: Record<string, unknown>) => (fields.trip_meta ?? {}) as Record<string, unknown>;

describe("where a trip was first saved from", () => {
  it("is written by the insert", async () => {
    const { client, rows } = fakeSupabase(null);
    await insertTrip(client, input("Lisbon, Portugal"), "user-1", { arm: "auto", mountId: "m_1" });
    expect(meta(rows[0])).toMatchObject({ save_arm: "auto", wizard_mount_id: "m_1" });
  });

  it("is kept by a regenerate, which rewrites the rest of trip_meta from the new plan", async () => {
    const { client, updates } = fakeSupabase({ trip_meta: { save_arm: "manual", wizard_mount_id: "m_1", pace: "packed" } });
    await updateTrip(client, "trip-1", input("Porto, Portugal"), "user-1");
    expect(meta(updates[0])).toMatchObject({ save_arm: "manual", wizard_mount_id: "m_1" });
    expect(meta(updates[0]).pace).not.toBe("packed");
  });

  it("is not made up for a trip that never recorded it, and a failed read still saves", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fake of [fakeSupabase({ trip_meta: { pace: "relaxed" } }), fakeSupabase(null, { message: "read refused" })]) {
      await updateTrip(fake.client, "trip-1", input("Porto, Portugal"), "user-1");
      expect(fake.updates).toHaveLength(1);
      expect(meta(fake.updates[0])).not.toHaveProperty("save_arm");
      expect(meta(fake.updates[0])).not.toHaveProperty("wizard_mount_id");
    }
    // The refused read is logged, not mistaken for "no origin" in silence.
    expect(logged).toHaveBeenCalledWith("[persistTrip: save origin] read failed:", "read refused");
    logged.mockRestore();
  });
});
