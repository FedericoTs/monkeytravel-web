/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertTrip, updateTrip, type PersistInput } from "./persistTrip";

/**
 * A trip's cover is set when it is created and kept after that. Updates (a
 * regeneration, a day edit, the streaming finalize) are the same destination,
 * and they used to write the fallback cover, null whenever the itinerary had
 * no place photo yet, erasing the cover the save had just attached.
 */

function fakeSupabase(reused = false) {
  const rows: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused }, error: null }) };
    },
    from: () => ({
      update: (fields: Record<string, unknown>) => {
        updates.push(fields);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { client: client as never, rows, updates };
}

const input = (activities: Array<{ type: string; image_url?: string }>) =>
  ({
    itinerary: {
      destination: { name: "Lisbon", description: "Hills and trams", weather_note: "", best_for: [] },
      days: [{ day_number: 1, activities: activities.map((a, i) => ({ id: `a${i}`, name: `A${i}`, ...a })) }],
      trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
      booking_links: {},
    },
    formState: { destination: "Lisbon, Portugal", startDate: "2026-10-21", endDate: "2026-10-25", derivedInterests: [], travelStyle: "classic" },
  }) as unknown as PersistInput;

const TOWER = "/api/places/photo?name=places%2Ftower%2Fphotos%2Fp&w=600&h=400&t=attraction";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});

describe("a trip's cover at creation", () => {
  it("is taken from the itinerary's place photos when it has one", async () => {
    const { client, rows } = fakeSupabase();
    await insertTrip(client, input([{ type: "restaurant" }, { type: "attraction", image_url: TOWER }]), "user-1");
    const cover = new URLSearchParams(String(rows[0].cover_image_url).split("?")[1]);
    expect(cover.get("name")).toBe("places/tower/photos/p");
    expect(cover.get("w")).toBe("1920");
  });

  it("is left empty, for the cover lookup that follows, when it has none", async () => {
    const { client, rows } = fakeSupabase();
    await insertTrip(client, input([{ type: "attraction", image_url: "https://images.pexels.com/photos/1/a.jpeg" }]), "user-1");
    expect(rows[0].cover_image_url).toBeNull();
  });
});

describe("photos of a planner save", () => {
  it("are not looked up: that waits until the trip is opened", async () => {
    const { client } = fakeSupabase();
    await insertTrip(client, input([{ type: "attraction", image_url: "https://images.pexels.com/photos/1/a.jpeg" }]), "user-1");
    await updateTrip(client, "trip-1", input([{ type: "attraction" }]), "user-1");
    await insertTrip(fakeSupabase(true).client, input([{ type: "attraction" }]), "user-1");
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(([url]) => String(url));
    expect(calls.filter((url) => url.includes("enrich-photos"))).toEqual([]);
  });
});

describe("a trip's cover after creation", () => {
  it("is not written by an update", async () => {
    const { client, updates } = fakeSupabase();
    await updateTrip(client, "trip-1", input([{ type: "attraction", image_url: TOWER }]), "user-1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("itinerary");
    expect(updates[0]).not.toHaveProperty("cover_image_url");
  });

  it("is not written when a duplicate save reuses the row", async () => {
    const { client, updates } = fakeSupabase(true);
    await insertTrip(client, input([{ type: "attraction", image_url: TOWER }]), "user-1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("cover_image_url");
  });
});
