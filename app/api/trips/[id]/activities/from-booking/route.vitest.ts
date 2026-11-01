// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, eqOf, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Adding a booking writes the itinerary only on the version it was computed
 * from: a save that lands in between stays, and the booking goes onto the
 * fresh copy of its day.
 */

const TRIP = "trip-1";
const OWNER = "owner-1";
const act = (id: string, name: string) => ({ id, name, start_time: "10:00", duration_minutes: 60, type: "attraction" });
const stored = {
  id: TRIP,
  user_id: OWNER,
  start_date: "2027-03-10",
  end_date: "2027-03-11",
  itinerary_version: 5,
  itinerary: [
    { day_number: 1, date: "2027-03-10", activities: [act("a1", "Belém Tower")] },
    { day_number: 2, date: "2027-03-11", activities: [act("b1", "Sintra")] },
  ],
};

// What the re-read finds after the first write misses: a mate's save on Day 2.
let fresh: Record<string, unknown> | null;
let writes: FakeQuery[];
const db = () =>
  fakeSupabase((q) => {
    if (q.table !== "trips") return { data: null, error: null };
    if (q.op === "update") {
      writes.push(q);
      // The first write is on version 5, which a save has moved on from.
      return eqOf(q, "itinerary_version") === 5 ? { data: [], error: null } : { data: [{ itinerary_version: 7 }], error: null };
    }
    if (q.end === "maybeSingle") return { data: fresh, error: null };
    return { data: stored, error: null };
  }).client;

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: OWNER }, supabase: db(), errorResponse: null }),
  verifyTripOwnership: async (supabase: { from: (t: string) => { select: () => { eq: () => { eq: () => { single: () => Promise<{ data: unknown }> } } } } }) => {
    const { data } = await supabase.from("trips").select().eq().eq().single();
    return { trip: data, errorResponse: null };
  },
}));

const { POST } = await import("./route");

const add = (day_number: number) =>
  POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/activities/from-booking`, {
      method: "POST",
      body: JSON.stringify({
        day_number,
        parsed: { kind: "restaurant", name: "Cervejaria Ramiro", startAt: "2027-03-11T20:00:00", raw_excerpt: "" },
      }),
    }),
    { params: Promise.resolve({ id: TRIP }) } as never
  );

beforeEach(() => {
  writes = [];
  fresh = {
    itinerary_version: 6,
    trip_meta: {},
    itinerary: [
      stored.itinerary[0],
      { day_number: 2, date: "2027-03-11", activities: [act("b1", "Sintra"), act("b2", "Pena Palace")] },
    ],
  };
});

describe("POST from-booking", () => {
  it("keeps a save made in between and adds the booking to the fresh day", async () => {
    const res = await add(2);
    expect(res.status).toBe(200);
    expect(writes.map((w) => eqOf(w, "itinerary_version"))).toEqual([5, 6]);
    const day2 = (writes[1].value as { itinerary: Array<{ day_number: number; activities: Array<{ name: string }> }> }).itinerary[1];
    expect(day2.activities.map((a) => a.name)).toEqual(["Sintra", "Pena Palace", "Cervejaria Ramiro"]);
  });

  it("answers 409 when the day is gone from the fresh copy", async () => {
    fresh = { itinerary_version: 6, trip_meta: {}, itinerary: [stored.itinerary[0]] };
    const res = await add(2);
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(1);
  });
});
