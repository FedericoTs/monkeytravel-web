// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, eqOf, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Proposals through the real routes. target_day is the day's 1-based number
 * everywhere; the owner's approve and the crew's deciding vote share one path
 * that puts the activity into the trip, then marks it approved; everyone sees
 * the proposer's public name. One fake world serves both Supabase clients.
 */

const TRIP = "11111111-2222-4333-8444-555555555555";
const PROPOSAL = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const OWNER = "owner-1";
const MATE = "mate-1";
const VOTER = "voter-1";
const ROLES: Record<string, string> = { [MATE]: "editor", [VOTER]: "voter" };
const NOW = new Date().toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

type Day = { day_number: number; date: string; activities: Array<{ id: string; name: string; start_time: string }> };
type World = {
  itinerary: Day[];
  version: number;
  proposal: Record<string, unknown> & { id: string; status: string; target_day: number };
  votes: Array<Record<string, unknown>>;
  profiles: Array<{ id: string; display_name: string | null; avatar_url: string | null }>;
  failStatusWrites: number;
};
let world: World;
let caller: { id: string; email: string };
const userLog: FakeQuery[] = [];
const adminLog: FakeQuery[] = [];

const notify = vi.fn();
vi.mock("@/lib/notifications/service", () => ({ enqueueNotification: (...args: unknown[]) => notify(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient() }));
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    getAuthenticatedUser: async () => ({ user: caller, supabase: userClient(), errorResponse: null }),
  };
});

/** The caller's own client. */
function userClient() {
  return fakeSupabase((q) => {
    userLog.push(q);
    switch (q.table) {
      case "trips":
        return { data: { id: TRIP, user_id: OWNER }, error: null };
      case "trip_collaborators": {
        if (q.end === "list") {
          const rows = Object.entries(ROLES).map(([user_id, role]) => ({ user_id, role }));
          return { data: rows, error: null, count: rows.length } as { data: unknown; error: unknown };
        }
        const role = ROLES[eqOf(q, "user_id") as string];
        return { data: role ? { role } : null, error: null };
      }
      case "activity_proposals":
        if (q.op === "insert") {
          world.proposal = {
            ...(q.value as object),
            id: PROPOSAL,
            created_at: NOW,
            updated_at: NOW,
            expires_at: hoursFromNow(24 * 7),
          } as unknown as World["proposal"];
          return { data: world.proposal, error: null };
        }
        return { data: q.end === "list" ? [world.proposal] : world.proposal, error: null };
      case "proposal_votes":
        if (q.op === "insert") {
          const vote = { id: `vote-${world.votes.length + 1}`, rank: null, voted_at: NOW, updated_at: NOW, ...(q.value as object) };
          world.votes.push(vote);
          return { data: vote, error: null };
        }
        if (q.end === "list") return { data: world.votes, error: null };
        return { data: world.votes.find((v) => v.user_id === eqOf(q, "user_id")) ?? null, error: null };
      case "public_profiles": {
        const ids = q.filters.find(([op, c]) => op === "in" && c === "id")?.[2] as string[];
        return { data: world.profiles.filter((p) => ids.includes(p.id)), error: null };
      }
      default:
        return { data: null, error: null };
    }
  }).client;
}

/** The service role, as the approval path uses it. */
function adminClient() {
  return fakeSupabase((q) => {
    adminLog.push(q);
    if (q.table === "trips" && q.op === "select") {
      return { data: { itinerary: world.itinerary, itinerary_version: world.version }, error: null };
    }
    if (q.table === "trips" && q.op === "update") {
      if (eqOf(q, "itinerary_version") !== world.version) return { data: [], error: null };
      world.itinerary = (q.value as { itinerary: Day[] }).itinerary;
      world.version += 1;
      return { data: [{ itinerary_version: world.version }], error: null };
    }
    if (q.table === "activity_proposals" && q.op === "update") {
      if (world.failStatusWrites > 0) {
        world.failStatusWrites--;
        return { data: null, error: { message: "boom" } };
      }
      const open = q.filters.find(([op, c]) => op === "in" && c === "status")?.[2] as string[] | undefined;
      if (open && !open.includes(world.proposal.status)) return { data: [], error: null };
      Object.assign(world.proposal, q.value);
      return { data: [{ id: world.proposal.id }], error: null };
    }
    if (q.table === "activity_proposals" && q.op === "select") return { data: { status: world.proposal.status }, error: null };
    return { data: null, error: null };
  }).client;
}

import { GET as listProposals, POST as createProposal } from "./route";
import { PATCH as resolveProposal } from "./[proposalId]/route";
import { POST as castVote } from "./[proposalId]/vote/route";

const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: TRIP, ...extra }) }) as never;
const request = (method: string, body?: unknown) =>
  new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/proposals`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
const dayNames = (dayNumber: number) => world.itinerary.find((d) => d.day_number === dayNumber)!.activities.map((a) => a.name);
const everywhere = () => world.itinerary.flatMap((d) => d.activities.map((a) => a.name));

beforeEach(() => {
  vi.clearAllMocks();
  userLog.length = 0;
  adminLog.length = 0;
  caller = { id: OWNER, email: "owner@example.com" };
  world = {
    itinerary: [
      {
        day_number: 1,
        date: "2026-11-01",
        activities: [
          { id: "a1", name: "Breakfast", start_time: "08:00" },
          { id: "a2", name: "Museum", start_time: "11:00" },
        ],
      },
      { day_number: 2, date: "2026-11-02", activities: [{ id: "b1", name: "Hike", start_time: "10:00" }] },
    ],
    version: 4,
    proposal: {
      id: PROPOSAL,
      trip_id: TRIP,
      proposed_by: MATE,
      type: "new",
      activity_data: { id: "proposed-1", name: "Rooftop bar", start_time: "09:00", duration_minutes: 90 },
      target_activity_id: null,
      target_day: 1,
      target_time_slot: null,
      note: null,
      status: "voting",
      resolved_at: null,
      resolved_by: null,
      resolution_method: null,
      created_at: hoursFromNow(-1),
      updated_at: hoursFromNow(-1),
      expires_at: hoursFromNow(24 * 6),
    },
    votes: [],
    profiles: [
      { id: OWNER, display_name: "Olive", avatar_url: null },
      { id: MATE, display_name: "Luca", avatar_url: "https://images.example/luca.png" },
      { id: VOTER, display_name: "Vera", avatar_url: null },
    ],
    failStatusWrites: 0,
  };
});

describe("who proposed it", () => {
  const list = async () => {
    const res = await listProposals(new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/proposals?status=active`), params());
    return { status: res.status, body: await res.json() };
  };

  it("another member sees the proposer's name, read from public_profiles", async () => {
    caller = { id: VOTER, email: "vera@example.com" };
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.proposals[0].proposer).toEqual({ display_name: "Luca", avatar_url: "https://images.example/luca.png" });
    expect(userLog.some((q) => q.table === "users")).toBe(false);
  });

  it("a profile name that is an email address is not shown", async () => {
    caller = { id: VOTER, email: "vera@example.com" };
    world.profiles[1].display_name = "luca@example.com";
    const { body } = await list();
    expect(body.proposals[0].proposer).toBeUndefined();
  });
});

describe("proposing an activity for a day", () => {
  it("stores Day 1 as 1, and tells the owner Day 1", async () => {
    caller = { id: MATE, email: "mate@example.com" };
    const res = await createProposal(
      request("POST", { type: "new", activityData: { name: "Rooftop bar", start_time: "09:00" }, targetDay: 1 }),
      params()
    );
    expect(res.status).toBe(200);
    expect(userLog.find((q) => q.table === "activity_proposals" && q.op === "insert")?.value).toMatchObject({ target_day: 1 });
    expect((await res.json()).proposal.proposer).toMatchObject({ display_name: "Luca" });
    expect(notify).toHaveBeenCalledTimes(1);
    const sent = notify.mock.calls[0][0];
    expect(sent.userId).toBe(OWNER);
    expect(sent.notification.data).toMatchObject({ day_number: 1, proposer_name: "Luca" });
    expect(sent.notification.data.message).toContain("for day 1");
  });

  it.each([0, -1, 1.5])("refuses day %s", async (targetDay) => {
    caller = { id: MATE, email: "mate@example.com" };
    const res = await createProposal(request("POST", { type: "new", activityData: { name: "Rooftop bar" }, targetDay }), params());
    expect(res.status).toBe(400);
    expect(userLog.some((q) => q.op === "insert")).toBe(false);
  });
});

describe("the owner's approve", () => {
  const approve = () =>
    resolveProposal(request("PATCH", { action: "approve", resolutionMethod: "owner_override" }), params({ proposalId: PROPOSAL }));

  it("puts the activity on the proposal's day, then marks the proposal approved", async () => {
    const res = await approve();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ activityAdded: true, proposal: { status: "approved" } });
    expect(dayNames(1)).toEqual(["Breakfast", "Rooftop bar", "Museum"]);
    expect(dayNames(2)).toEqual(["Hike"]);
    expect(world.version).toBe(5);
    expect(adminLog.find((q) => q.table === "trips" && q.op === "update")?.filters).toContainEqual(["eq", "itinerary_version", 4]);
    expect(world.proposal).toMatchObject({ status: "approved", resolved_by: OWNER, resolution_method: "owner_override" });
  });

  it("a proposal for the last day lands on the last day", async () => {
    world.proposal.target_day = 2;
    expect((await approve()).status).toBe(200);
    expect(dayNames(2)).toEqual(["Rooftop bar", "Hike"]);
  });

  it("approving again after a failed status write adds the activity once", async () => {
    world.failStatusWrites = 1;
    expect((await approve()).status).toBe(500);
    expect(world.proposal.status).toBe("voting");

    expect((await approve()).status).toBe(200);
    expect(everywhere().filter((n) => n === "Rooftop bar")).toHaveLength(1);
    expect(world.proposal.status).toBe("approved");
  });

  it("refuses with 409 when the day is gone, and the proposal stays open", async () => {
    world.proposal.target_day = 5;
    expect((await approve()).status).toBe(409);
    expect(world.version).toBe(4);
    expect(world.proposal.status).toBe("voting");
  });

  it("is the owner's only", async () => {
    caller = { id: MATE, email: "mate@example.com" };
    expect((await approve()).status).toBe(403);
    expect(adminLog).toHaveLength(0);
  });
});

describe("the crew's deciding vote", () => {
  const vote = () => castVote(request("POST", { voteType: "love" }), params({ proposalId: PROPOSAL }));

  beforeEach(() => {
    world.votes.push({ id: "vote-0", proposal_id: PROPOSAL, user_id: OWNER, vote_type: "love", comment: null, rank: null, voted_at: NOW, updated_at: NOW });
    caller = { id: VOTER, email: "vera@example.com" };
  });

  it("approves through the same path: the activity lands on its day", async () => {
    const res = await vote();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resolved: "approved", activityAdded: true, consensusApplied: true });
    expect(dayNames(1)).toEqual(["Breakfast", "Rooftop bar", "Museum"]);
    expect(adminLog.find((q) => q.table === "trips" && q.op === "update")?.filters).toContainEqual(["eq", "itinerary_version", 4]);
    expect(world.proposal).toMatchObject({ status: "approved", resolution_method: "consensus", resolved_by: null });
  });

  it("says so when the activity could not be added, and leaves the proposal open", async () => {
    world.proposal.target_day = 5;
    const res = await vote();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resolved: null, activityAdded: false, consensusApplied: false });
    expect(world.proposal.status).toBe("voting");
    expect(world.version).toBe(4);
  });
});
