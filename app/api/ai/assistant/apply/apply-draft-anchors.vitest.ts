// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A multi-day change (apply_draft) may rewrite any day without a fixed plan.
 * It used to be refused when ANY day of the trip had one, which the
 * assistant's free-form edits hit on every anchored trip, though they never
 * rewrite an anchored day. A day with a fixed plan is still never rewritten.
 * The real route runs against a fake Supabase.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));
vi.mock("@/lib/ai/assistant-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/assistant-access")>()),
  resolveAssistantRole: async () => "owner",
}));

const updates: Array<Record<string, unknown>> = [];
const act = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, type: "culture", start_time: "09:00", duration_minutes: 60, time_slot: "morning", ...extra,
});
const storedTrip = () => ({
  id: TRIP,
  user_id: OWNER,
  start_date: "2026-11-24",
  end_date: "2026-11-25",
  itinerary: [
    { day_number: 1, date: "2026-11-24", activities: [act("a1", "Wedding", { locked: true }), act("a2", "Bravo")] },
    { day_number: 2, date: "2026-11-25", activities: [act("b1", "Echo")] },
  ],
});

function fakeSupabase() {
  return {
    from() {
      let pending = false;
      const q = {
        select: () => (pending ? Promise.resolve({ data: [{ id: TRIP, itinerary_version: 3 }], error: null }) : q),
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: storedTrip(), error: null }),
        update: (values: Record<string, unknown>) => {
          pending = true;
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

async function apply(days: unknown[]) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant/apply", {
      method: "POST",
      body: JSON.stringify({ tripId: TRIP, changeType: "apply_draft", dayNumber: 2, days }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  updates.length = 0;
});

describe("apply_draft on a trip with a fixed plan", () => {
  it("rewrites a day without one, and leaves the fixed day as it is", async () => {
    const { status } = await apply([{ day_number: 2, date: "2026-11-25", activities: [act("b1", "Echo"), act("n1", "Night tour")] }]);
    expect(status).toBe(200);
    expect(updates).toHaveLength(1);
    const days = updates[0].itinerary as Array<{ activities: Array<{ name: string; locked?: boolean }> }>;
    expect(days[0].activities.map((a) => a.name)).toEqual(["Wedding", "Bravo"]);
    expect(days[0].activities[0].locked).toBe(true);
    expect(days[1].activities.map((a) => a.name)).toEqual(["Echo", "Night tour"]);
  });

  it("refuses to rewrite the day that holds it", async () => {
    const { status } = await apply([{ day_number: 1, date: "2026-11-24", activities: [act("x1", "Brunch")] }]);
    expect(status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
