// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Apply writes the changed itinerary only onto the version it was computed
 * from. A save that lands between the read and the write gets a 409 OUTDATED
 * back instead of being overwritten with the older copy.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));

const act = (id: string, name: string) => ({ id, name, type: "culture", start_time: "09:00", duration_minutes: 60, time_slot: "morning" });

let row: Record<string, unknown> & { itinerary_version: number };
let saveLandsDuringApply: boolean;
let writes: number;

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
        return q;
      }
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      const q = {
        select: () => (values ? commit() : q),
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        update: (v: Record<string, unknown>) => ((values = v), q),
        single: async () => {
          const read = { ...row };
          // Someone else's save lands right after this read.
          if (saveLandsDuringApply) row = { ...row, itinerary_version: row.itinerary_version + 1 };
          return { data: read, error: null };
        },
        maybeSingle: async () => ({ data: { itinerary_version: row.itinerary_version }, error: null }),
      };
      const commit = async () => {
        if ("itinerary_version" in filters && filters.itinerary_version !== row.itinerary_version) return { data: [], error: null };
        writes++;
        row = { ...row, ...(values as object), itinerary_version: row.itinerary_version + 1 };
        return { data: [{ id: TRIP, itinerary_version: row.itinerary_version }], error: null };
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: OWNER }, supabase: fakeSupabase(), errorResponse: null }),
}));

async function apply() {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant/apply", {
      method: "POST",
      body: JSON.stringify({ tripId: TRIP, changeType: "remove", dayNumber: 1, oldActivity: act("a2", "Bravo") }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  saveLandsDuringApply = false;
  writes = 0;
  row = {
    id: TRIP,
    user_id: OWNER,
    start_date: "2026-11-24",
    end_date: "2026-11-24",
    itinerary: [{ day_number: 1, date: "2026-11-24", activities: [act("a1", "Alpha"), act("a2", "Bravo")] }],
    itinerary_version: 3,
  };
});

describe("apply on a trip someone else just saved", () => {
  it("writes when the trip is still at the version it read, and returns the new one", async () => {
    const { status, json } = await apply();
    expect(status).toBe(200);
    expect(writes).toBe(1);
    expect((json.data ?? json).itineraryVersion).toBe(4);
  });

  it("answers 409 OUTDATED instead of overwriting a save that landed in between", async () => {
    saveLandsDuringApply = true;
    const { status, json } = await apply();
    expect(status).toBe(409);
    expect(json.code).toBe("OUTDATED");
    expect(writes).toBe(0);
  });
});
