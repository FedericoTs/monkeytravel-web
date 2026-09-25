// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Who may apply an assistant change.
 *
 * Owner-only until 2026-09-25 while the trip page offered the assistant to
 * every role: an invited editor's first message answered "Trip not found".
 * The owner and editors may now apply content changes; adding days and
 * shifting them move the trip's dates, which stay with the owner (as on
 * PATCH /api/trips/[id]). Voters and viewers get 403. The real route runs
 * against a fake Supabase.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));

let caller: string;
let roles: Record<string, string>;
let tripVisible: boolean;
const updates: Array<Record<string, unknown>> = [];

const act = (id: string, name: string) => ({ id, name, type: "culture", start_time: "09:00", duration_minutes: 60, time_slot: "morning" });
const storedTrip = () => ({
  id: TRIP,
  user_id: OWNER,
  start_date: "2026-11-24",
  end_date: "2026-11-25",
  itinerary: [
    { day_number: 1, date: "2026-11-24", activities: [act("a1", "Alpha"), act("a2", "Bravo")] },
    { day_number: 2, date: "2026-11-25", activities: [act("b1", "Echo")] },
  ],
});

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const filters: Record<string, unknown> = {};
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => {
            filters[c] = v;
            return q;
          },
          maybeSingle: async () => {
            const role = roles[String(filters.user_id)];
            return { data: role ? { role } : null, error: null };
          },
        };
        return q;
      }
      // trips: honours a `user_id` filter, as the database would.
      let pending: Record<string, unknown> | null = null;
      const tripFilters: Record<string, unknown> = {};
      const q = {
        select: () => (pending ? Promise.resolve({ data: [{ id: TRIP, itinerary_version: 8 }], error: null }) : q),
        eq: (c: string, v: unknown) => {
          tripFilters[c] = v;
          return q;
        },
        single: async () =>
          tripVisible && (!("user_id" in tripFilters) || tripFilters.user_id === OWNER)
            ? { data: storedTrip(), error: null }
            : { data: null, error: { code: "PGRST116" } },
        update: (values: Record<string, unknown>) => {
          pending = values;
          updates.push(values);
          return q;
        },
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
}));

async function apply(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant/apply", { method: "POST", body: JSON.stringify({ tripId: TRIP, ...body }) })
  );
  return { status: res.status, json: await res.json() };
}

const removeBravo = { changeType: "remove", dayNumber: 1, oldActivity: act("a2", "Bravo") };
const addDay = {
  changeType: "add_day",
  dayNumber: 3,
  day: { day_number: 3, date: "2026-11-26", theme: "Fjords", activities: [act("c1", "Ferry")] },
};

beforeEach(() => {
  caller = OWNER;
  roles = { "mate-1": "editor", "voter-1": "voter", "viewer-1": "viewer" };
  tripVisible = true;
  updates.length = 0;
});

describe("assistant apply: who may change what", () => {
  it("an invited editor applies a content change", async () => {
    caller = "mate-1";
    const { status } = await apply(removeBravo);
    expect(status).toBe(200);
    expect(updates).toHaveLength(1);
    const names = (updates[0].itinerary as Array<{ activities: Array<{ name: string }> }>).flatMap((d) => d.activities.map((a) => a.name));
    expect(names).toEqual(["Alpha", "Echo"]);
    expect(updates[0]).not.toHaveProperty("end_date");
    expect(updates[0]).not.toHaveProperty("start_date");
  });

  it("an editor cannot add days: that moves the trip's dates", async () => {
    caller = "mate-1";
    const { status, json } = await apply(addDay);
    expect(status).toBe(403);
    expect(JSON.stringify(json)).toMatch(/only the trip owner can add days/i);
    expect(updates).toHaveLength(0);
  });

  it("an editor cannot shift days", async () => {
    caller = "mate-1";
    const { status } = await apply({ changeType: "shift_days", dayNumber: 1, shiftByDays: 2 });
    expect(status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("the owner can add a day, and the end date moves with it", async () => {
    const { status } = await apply(addDay);
    expect(status).toBe(200);
    expect(updates[0].end_date).toBe("2026-11-26");
  });

  it("voters and viewers get 403 and nothing is written", async () => {
    for (const who of ["voter-1", "viewer-1", "stranger"]) {
      caller = who;
      const { status } = await apply(removeBravo);
      expect(status).toBe(403);
    }
    expect(updates).toHaveLength(0);
  });

  it("a trip the caller cannot see is still a 404", async () => {
    caller = "stranger";
    tripVisible = false;
    const { status } = await apply(removeBravo);
    expect(status).toBe(404);
  });
});
