// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A vote can close a proposal, and closing one writes the activity into the
 * trip. Consensus is a share of the trip's voters, so without the voter
 * count one vote would be a quorum. A read the database refused decides
 * nothing: the vote is saved and the next one re-checks.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";
const PROPOSAL = "proposal-1";
let voterCount: { count: number | null; error: { message: string } | null };
let insertedVotes = 0;

const approveProposal = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/proposals/approve", () => ({ approveProposal }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const NOW = new Date().toISOString();
const vote = { id: "vote-1", proposal_id: PROPOSAL, user_id: OWNER, vote_type: "love", comment: null, voted_at: NOW };

function fakeSupabase() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let columns = "";
      let inserting = false;
      const q = {
        select: (c = "") => ((columns = c), q),
        insert: () => ((inserting = true), insertedVotes++, q),
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        in: () => q,
        single: async () => {
          if (table === "activity_proposals" && columns.startsWith("created_at")) {
            return { data: { created_at: NOW, expires_at: null }, error: null };
          }
          if (table === "activity_proposals") {
            return { data: { id: PROPOSAL, trip_id: TRIP, status: "voting", proposed_by: OWNER, target_day: 1, activity_data: {} }, error: null };
          }
          if (table === "trips") return { data: { id: TRIP, user_id: OWNER }, error: null };
          if (table === "proposal_votes" && inserting) return { data: vote, error: null };
          return { data: null, error: { code: "PGRST116", message: "no rows" } };
        },
        // No earlier vote by this voter.
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve(table === "trip_collaborators" ? voterCount : { data: [vote], error: null }),
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () => ({ user: { id: OWNER }, supabase: fakeSupabase(), errorResponse: null }),
}));

async function castLove() {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/proposals/${PROPOSAL}/vote`, {
      method: "POST",
      body: JSON.stringify({ voteType: "love" }),
    }),
    { params: Promise.resolve({ id: TRIP, proposalId: PROPOSAL }) }
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  approveProposal.mockClear();
  insertedVotes = 0;
  voterCount = { count: 0, error: null };
});

describe("the consensus a vote triggers", () => {
  it("applies an approval the trip's voters reached", async () => {
    const { status, json } = await castLove();
    expect(status).toBe(200);
    expect(approveProposal).toHaveBeenCalledTimes(1);
    expect(json).toMatchObject({ consensusApplied: true, resolved: "approved" });
  });

  it("waits for the rest of a larger group", async () => {
    voterCount = { count: 3, error: null };
    const { json } = await castLove();
    expect(approveProposal).not.toHaveBeenCalled();
    expect(json.resolved).toBeNull();
  });

  it("decides nothing when the voter count can't be read, and keeps the vote", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    voterCount = { count: null, error: { message: "canceling statement due to statement timeout" } };
    const { status, json } = await castLove();
    expect(status).toBe(200);
    expect(insertedVotes).toBe(1);
    expect(approveProposal).not.toHaveBeenCalled();
    expect(json).toMatchObject({ consensusApplied: false, resolved: null });
  });
});
