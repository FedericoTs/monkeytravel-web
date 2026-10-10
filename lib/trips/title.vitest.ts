/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newTripTitle } from "./title";
import { insertTrip, type PersistInput } from "./persistTrip";

/**
 * A trip made in Italian was saved as "Lisbona Trip". New titles follow the
 * page's language; English keeps "{destination} Trip".
 */
describe("newTripTitle", () => {
  it("keeps English as '{destination} Trip'", () => {
    expect(newTripTitle("Lisbon", "en")).toBe("Lisbon Trip");
  });

  it("uses the destination alone in Italian, Spanish and Portuguese", () => {
    expect(newTripTitle("Lisbona", "it")).toBe("Lisbona");
    expect(newTripTitle("Japón", "es")).toBe("Japón");
    expect(newTripTitle("Lisboa", "pt-BR")).toBe("Lisboa");
  });

  it("falls back to English when the locale is missing or unsupported", () => {
    expect(newTripTitle("Lisbon", undefined)).toBe("Lisbon Trip");
    expect(newTripTitle("Lisbon", "fr")).toBe("Lisbon Trip");
  });

  it("trims the destination", () => {
    expect(newTripTitle("  Roma ", "it")).toBe("Roma");
  });
});

// The auto-save arm builds its row in persistTrip; the wizard's own save uses
// newTripTitle with the same page locale, so insert_trip_dedup still pairs them.
function capturingSupabase() {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_name: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
  };
  return { client: client as never, rows };
}

const input = (name: string, locale?: string) =>
  ({
    itinerary: {
      destination: { name, description: "", weather_note: "", best_for: [] },
      days: [{ day_number: 1, activities: [] }],
      trip_summary: { total_estimated_cost: 0, currency: "EUR", highlights: [], packing_suggestions: [] },
      booking_links: {},
    },
    formState: { destination: name, startDate: "2026-11-24", endDate: "2026-11-24", derivedInterests: [], locale },
  }) as unknown as PersistInput;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});

describe("insertTrip's title", () => {
  it("is the destination alone for an Italian page", async () => {
    const { client, rows } = capturingSupabase();
    await insertTrip(client, input("Lisbona", "it"), "user-1");
    expect(rows[0].title).toBe("Lisbona");
  });

  it("stays '{destination} Trip' for an English page", async () => {
    const { client, rows } = capturingSupabase();
    await insertTrip(client, input("Lisbon", "en"), "user-1");
    expect(rows[0].title).toBe("Lisbon Trip");
  });
});
