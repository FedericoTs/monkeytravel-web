// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * What the vote email tells the owner.
 *
 * The owner reads the activity label in the email: the activity's name, not
 * its id (a friend loving "act_7f3…" tells them nothing).
 */

const TRIP = "trip-1";
const OWNER = "owner-1";
const VOTER = "voter-1";

let caller: string;
let itinerary: unknown;
const emails: Array<Record<string, unknown>> = [];
const sendVoteEmail = vi.fn(async (e: Record<string, unknown>) => {
  emails.push(e);
});
vi.mock("@/lib/notifications/vote-email", () => ({
  sendVoteEmail: (e: Record<string, unknown>) => sendVoteEmail(e),
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
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
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
  emails.length = 0;
  itinerary = [
    { day_number: 1, activities: [{ id: "act_7f3a", name: "Boqueria Market" }] },
    { day_number: 2, activities: [{ id: "act_9c1d", name: "Sagrada Família" }] },
  ];
});

describe("vote email", () => {
  it("names the activity, the trip and who voted", async () => {
    expect(await vote("act_9c1d")).toBe(200);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      ownerId: OWNER,
      voterId: VOTER,
      tripId: TRIP,
      activityId: "act_9c1d",
      activityLabel: "Sagrada Família",
      voterName: "Ana",
      vote: "love",
    });
  });

  it("falls back to the id when the activity is no longer in the trip", async () => {
    expect(await vote("act_gone")).toBe(200);
    expect(emails[0].activityLabel).toBe("act_gone");
  });

  it("survives a malformed itinerary", async () => {
    itinerary = [{ day_number: 1 }];
    expect(await vote("act_9c1d")).toBe(200);
    expect(emails[0].activityLabel).toBe("act_9c1d");
  });

  it("the owner voting on their own trip emails nobody", async () => {
    caller = OWNER;
    expect(await vote("act_9c1d")).toBe(200);
    expect(emails).toHaveLength(0);
  });
});
