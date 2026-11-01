// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { buildApplyBody, type PendingChange } from "@/lib/ai/assistant/pending-change";

/**
 * The /apply contract: every change the assistant panel or the concierge can
 * propose, built by buildApplyBody, is accepted and written by the route. The
 * two clients built the body by hand, each for its own types, and one wrong
 * field (a multi-day draft's day number) turned every Save into a 400.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));

const updates: Array<Record<string, unknown>> = [];

const act = (id: string, name: string, start = "09:00") => ({ id, name, type: "culture", start_time: start, duration_minutes: 60, time_slot: "morning" });
const storedTrip = () => ({
  id: TRIP,
  user_id: OWNER,
  start_date: "2026-11-24",
  end_date: "2026-11-25",
  itinerary: [
    { day_number: 1, date: "2026-11-24", activities: [act("a1", "Alpha"), act("a2", "Bravo", "11:00")] },
    { day_number: 2, date: "2026-11-25", activities: [act("b1", "Echo")] },
  ],
});

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
        return q;
      }
      let pending: Record<string, unknown> | null = null;
      const q = {
        select: () => (pending ? Promise.resolve({ data: [{ id: TRIP, itinerary_version: 8 }], error: null }) : q),
        eq: () => q,
        single: async () => ({ data: storedTrip(), error: null }),
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
  getAuthenticatedUser: async () => ({ user: { id: OWNER }, supabase: fakeSupabase(), errorResponse: null }),
}));

async function post(change: PendingChange) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant/apply", {
      method: "POST",
      body: JSON.stringify(buildApplyBody(change, { tripId: TRIP })),
    }),
  );
  return { status: res.status, json: await res.json() };
}

const day3 = { day_number: 3, date: "2026-11-26", theme: "Fjords", activities: [act("c1", "Ferry")] };

const changes: Array<[string, PendingChange]> = [
  ["replace", { type: "replace", dayNumber: 1, oldActivity: act("a2", "Bravo"), newActivity: act("n1", "Charlie") }],
  ["add", { type: "add", dayNumber: 2, newActivity: act("n2", "Delta", "15:00") }],
  ["remove", { type: "remove", dayNumber: 1, oldActivity: act("a1", "Alpha") }],
  ["adjust_duration", { type: "adjust_duration", dayNumber: 2, activity: { id: "b1", name: "Echo", type: "culture" }, oldDuration: 60, newDuration: 90 }],
  [
    "reorder",
    {
      type: "reorder",
      dayNumber: 1,
      activities: [
        { id: "a2", name: "Bravo", time: "09:00", timeSlot: "morning" },
        { id: "a1", name: "Alpha", time: "11:00", timeSlot: "morning" },
      ],
    },
  ],
  ["add_day", { type: "add_day", dayNumber: 3, day: day3 as never }],
  [
    "apply_draft",
    {
      type: "apply_draft",
      days: [{ day_number: 2, date: "2026-11-25", activities: [act("b1", "Echo"), act("n3", "Night tour", "20:00")] }] as never,
      changedDayNumbers: [2],
    },
  ],
  ["shift_days", { type: "shift_days", dayNumber: 2, shiftByDays: 1, lastDayNumber: 2 }],
];

beforeEach(() => {
  updates.length = 0;
});

describe("every proposed change type, built by buildApplyBody, is applied", () => {
  it.each(changes)("%s", async (_name, change) => {
    const { status, json } = await post(change);
    expect(status, JSON.stringify(json)).toBe(200);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("a multi-day draft is keyed on its first changed day", () => {
    const body = buildApplyBody(
      { type: "apply_draft", days: [] as never, changedDayNumbers: [4, 2] },
      { tripId: TRIP, conversationId: "c-1" },
    );
    expect(body).toMatchObject({ changeType: "apply_draft", dayNumber: 4, conversationId: "c-1" });
  });
});
