/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";
import type { UserProfile } from "@/lib/api/batch-users";
import { toProposalVote, toProposalWithVotes, tripVoterIds, type ProposalRow, type VoteRow } from "./read";

const NOW = Date.now();
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();

const profiles = new Map<string, UserProfile>([
  ["owner-1", { id: "owner-1", display_name: "Olive", avatar_url: null }],
  ["mate-1", { id: "mate-1", display_name: "Luca", avatar_url: "https://images.example/luca.png" }],
  ["blank-1", { id: "blank-1", display_name: "", avatar_url: null }],
]);

const vote = (user_id: string, vote_type: string, extra: Partial<VoteRow> = {}): VoteRow => ({
  id: `vote-${user_id}`,
  proposal_id: "p-1",
  user_id,
  vote_type,
  voted_at: at(-2),
  updated_at: at(-1),
  ...extra,
});

const proposal = (extra: Partial<ProposalRow> = {}): ProposalRow => ({
  id: "p-1",
  trip_id: "trip-1",
  proposed_by: "mate-1",
  type: "new",
  activity_data: { id: "a-9", name: "Rooftop bar" },
  target_activity_id: null,
  target_day: 1,
  target_time_slot: null,
  note: null,
  status: "voting",
  resolved_at: null,
  resolved_by: null,
  resolution_method: null,
  created_at: at(-5),
  updated_at: at(-5),
  expires_at: at(24),
  ...extra,
});

describe("a vote", () => {
  it("carries its voter's public name and avatar", () => {
    expect(toProposalVote(vote("mate-1", "love", { comment: "Yes!", rank: 1 }), profiles)).toEqual({
      id: "vote-mate-1",
      proposal_id: "p-1",
      user_id: "mate-1",
      vote_type: "love",
      comment: "Yes!",
      rank: 1,
      voted_at: at(-2),
      updated_at: at(-1),
      user: { display_name: "Luca", avatar_url: "https://images.example/luca.png" },
    });
  });

  it("reads Unknown for a profile without a name, and has no user without a profile", () => {
    expect(toProposalVote(vote("blank-1", "no"), profiles).user).toEqual({ display_name: "Unknown", avatar_url: undefined });
    expect(toProposalVote(vote("stranger-1", "no"), profiles).user).toBeUndefined();
  });
});

describe("a trip's voters", () => {
  const collaborators = (rows: Array<{ user_id: string; role: string }>, error: unknown = null) =>
    fakeSupabase((q) => (q.table === "trip_collaborators" ? { data: rows, error } : { data: null, error: null }));

  it("are the owner and the collaborators who vote, each once", async () => {
    const { client, log } = collaborators([
      { user_id: "mate-1", role: "editor" },
      { user_id: "voter-1", role: "voter" },
      { user_id: "owner-1", role: "owner" },
    ]);
    expect(await tripVoterIds(client as never, "trip-1", "owner-1")).toEqual(["owner-1", "mate-1", "voter-1"]);
    expect(log[0].filters).toEqual([
      ["eq", "trip_id", "trip-1"],
      ["in", "role", ["owner", "editor", "voter"]],
    ]);
  });

  it("are only the collaborators when the owner is not known", async () => {
    const { client } = collaborators([{ user_id: "mate-1", role: "editor" }]);
    expect(await tripVoterIds(client as never, "trip-1", null)).toEqual(["mate-1"]);
  });

  it("cannot be counted when the collaborators cannot be read", async () => {
    const { client } = collaborators([], { message: "timeout" });
    await expect(tripVoterIds(client as never, "trip-1", "owner-1")).rejects.toEqual({ message: "timeout" });
  });
});

describe("a proposal with its votes", () => {
  const votes = [toProposalVote(vote("owner-1", "love"), profiles), toProposalVote(vote("mate-1", "flexible"), profiles)];
  const context = { voterIds: ["owner-1", "mate-1", "voter-1"], profiles, callerId: "mate-1" };

  it("summarizes the votes and the consensus among the trip's voters, with the caller's vote", () => {
    const p = toProposalWithVotes(proposal(), votes, context);
    expect(p.votes).toBe(votes);
    expect(p.vote_summary).toEqual({ love: 1, flexible: 1, concerns: 0, no: 0, total: 2 });
    expect(p.consensus).toMatchObject({ participation: 2 / 3, pendingVoters: ["voter-1"] });
    expect(p.current_user_vote).toBe("flexible");
    expect(p.proposer).toEqual({ display_name: "Luca", avatar_url: "https://images.example/luca.png" });
  });

  it("leaves out what the row does not have", () => {
    const p = toProposalWithVotes(proposal(), [], { ...context, callerId: "voter-1" });
    for (const key of ["target_activity_id", "note", "resolved_at", "resolved_by", "resolution_method", "current_user_vote"] as const) {
      expect(p[key]).toBeUndefined();
    }
    expect(JSON.parse(JSON.stringify(p))).not.toHaveProperty("resolution_method");
  });

  it("keeps a resolved proposal's resolution", () => {
    const p = toProposalWithVotes(
      proposal({ status: "approved", resolved_at: at(-1), resolved_by: "owner-1", resolution_method: "consensus", note: "Sunset" }),
      votes,
      context
    );
    expect(p).toMatchObject({ status: "approved", resolved_at: at(-1), resolved_by: "owner-1", resolution_method: "consensus", note: "Sunset" });
  });
});
