// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * What a vote notification tells the owner.
 *
 * The owner reads the activity label in the push ('👍 on "…"') and in the
 * email. Until 2026-09-25 it was the activity's id, so owners were told a
 * friend loved "act_7f3…"; it is now the activity's name, and the link opens
 * the trip (/trips/<id>, not the /edit page that never existed).
 */

const TRIP = "trip-1";
const OWNER = "owner-1";
const VOTER = "voter-1";

let caller: string;
let itinerary: unknown;
const notifications: Array<Record<string, unknown>> = [];
const enqueueNotification = vi.fn(async (n: Record<string, unknown>) => {
  notifications.push(n);
});
vi.mock("@/lib/notifications/service", () => ({
  enqueueNotification: (n: Record<string, unknown>) => enqueueNotification(n),
}));
vi.mock("@/lib/api/batch-users", () => ({ batchFetchUserProfiles: vi.fn() }));

function fakeSupabase() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, { select: chain, eq: chain, update: chain, insert: chain });
      q.single = async () => {
        if (table === "trips") return { data: { id: TRIP, user_id: OWNER }, error: null };
        if (table === "trip_collaborators") return { data: caller === OWNER ? null : { role: "voter" }, error: null };
        // activity_votes: no earlier vote; the insert returns the new row.
        return { data: null, error: null };
      };
      q.maybeSingle = async () => {
        if (table === "users") return { data: { display_name: "Ana" }, error: null };
        if (table === "trips") return { data: { itinerary }, error: null };
        return { data: null, error: null };
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
  verifyTripAccess: vi.fn(),
}));

async function vote(activityId: string) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/activities/${activityId}/vote`, {
      method: "POST",
      body: JSON.stringify({ voteType: "love" }),
    }),
    { params: Promise.resolve({ id: TRIP, activityId }) }
  );
  await new Promise((r) => setTimeout(r, 0));
  return res.status;
}

beforeEach(() => {
  caller = VOTER;
  notifications.length = 0;
  itinerary = [
    { day_number: 1, activities: [{ id: "act_7f3a", name: "Boqueria Market" }] },
    { day_number: 2, activities: [{ id: "act_9c1d", name: "Sagrada Família" }] },
  ];
});

describe("vote notification", () => {
  it("names the activity and links to the trip", async () => {
    expect(await vote("act_9c1d")).toBe(200);
    expect(notifications).toHaveLength(1);
    const data = (notifications[0].notification as { data: Record<string, unknown> }).data;
    expect(data.activity_label).toBe("Sagrada Família");
    expect(data.href).toBe(`/trips/${TRIP}`);
    expect(data.trip_id).toBe(TRIP);
  });

  it("falls back to the id when the activity is no longer in the trip", async () => {
    expect(await vote("act_gone")).toBe(200);
    const data = (notifications[0].notification as { data: Record<string, unknown> }).data;
    expect(data.activity_label).toBe("act_gone");
  });

  it("survives a malformed itinerary", async () => {
    itinerary = [{ day_number: 1 }];
    expect(await vote("act_9c1d")).toBe(200);
    const data = (notifications[0].notification as { data: Record<string, unknown> }).data;
    expect(data.activity_label).toBe("act_9c1d");
  });

  it("the owner voting on their own trip notifies nobody", async () => {
    caller = OWNER;
    expect(await vote("act_9c1d")).toBe(200);
    expect(notifications).toHaveLength(0);
  });
});
