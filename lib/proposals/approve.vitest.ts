// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { fakeSupabase, eqOf, type FakeQuery } from "@/tests/fake-supabase";
import { addProposalActivity, approveProposal, proposalActivityId, type ApprovableProposal } from "./approve";

/**
 * One approval path for the owner's approve and the crew's votes: the
 * activity goes into the trip on its day (target_day is the day's 1-based
 * day_number), written compare-and-set, then the proposal reads approved.
 * Running it again never adds the activity twice.
 */

const PROPOSAL_ID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const ACT_ID = proposalActivityId(PROPOSAL_ID);

type Day = { day_number: number; date: string; activities: Array<{ id: string; name: string; start_time: string }> };

const days = (): Day[] => [
  {
    day_number: 1,
    date: "2026-11-01",
    activities: [
      { id: "a1", name: "Breakfast", start_time: "08:00" },
      { id: "a2", name: "Museum", start_time: "11:00" },
    ],
  },
  { day_number: 2, date: "2026-11-02", activities: [{ id: "b1", name: "Hike", start_time: "10:00" }] },
  { day_number: 3, date: "2026-11-03", activities: [] },
];

const proposal = (targetDay: number): ApprovableProposal => ({
  id: PROPOSAL_ID,
  trip_id: "trip-1",
  target_day: targetDay,
  activity_data: { id: "proposed-123", name: "Rooftop bar", start_time: "09:00", duration_minutes: 90 },
});

const names = (itinerary: unknown, dayNumber: number) =>
  ((itinerary as Day[]).find((d) => d.day_number === dayNumber)?.activities ?? []).map((a) => a.name);

describe("addProposalActivity", () => {
  it("puts a Day 1 proposal on Day 1, in time order, without moving the others", () => {
    const next = addProposalActivity(days(), proposal(1));
    expect(names(next, 1)).toEqual(["Breakfast", "Rooftop bar", "Museum"]);
    expect(names(next, 2)).toEqual(["Hike"]);
  });

  it("reaches the last day", () => {
    expect(names(addProposalActivity(days(), proposal(3)), 3)).toEqual(["Rooftop bar"]);
  });

  it("gives the activity an id from the proposal, not from the proposer's payload", () => {
    const next = addProposalActivity(days(), proposal(2)) as unknown as Day[];
    expect(next[1].activities.map((a) => a.id)).toEqual([ACT_ID, "b1"]);
    expect(ACT_ID).toMatch(/^act_[0-9a-f]{12}$/);
  });

  it("is a no-op once the activity is in the trip, on any day", () => {
    const once = addProposalActivity(days(), proposal(1));
    expect(addProposalActivity(once, proposal(1))).toBe("present");
    expect(addProposalActivity(once, proposal(2))).toBe("present");
  });

  it("refuses a day the trip no longer has", () => {
    expect(addProposalActivity(days(), proposal(4))).toBe("no_day");
    expect(addProposalActivity(null, proposal(1))).toBe("no_day");
  });
});

describe("approveProposal", () => {
  let trip: { itinerary: unknown; itinerary_version: number };
  let status: string;
  // Someone else saves the trip right before the next write lands.
  let bumpBeforeWrite: boolean;
  let failStatusWrite: boolean;
  let log: FakeQuery[];

  function admin() {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips" && q.op === "select") return { data: { ...trip }, error: null };
      if (q.table === "trips" && q.op === "update") {
        if (bumpBeforeWrite) {
          bumpBeforeWrite = false;
          const theirs = days();
          theirs[1].activities.push({ id: "b2", name: "Their dinner", start_time: "20:00" });
          trip = { itinerary: theirs, itinerary_version: trip.itinerary_version + 1 };
        }
        if (eqOf(q, "itinerary_version") !== trip.itinerary_version) return { data: [], error: null };
        trip = { itinerary: (q.value as { itinerary: unknown }).itinerary, itinerary_version: trip.itinerary_version + 1 };
        return { data: [{ itinerary_version: trip.itinerary_version }], error: null };
      }
      if (q.table === "activity_proposals" && q.op === "update") {
        if (failStatusWrite) return { data: null, error: { message: "boom" } };
        const open = q.filters.find(([op, c]) => op === "in" && c === "status")?.[2] as string[];
        if (!open.includes(status)) return { data: [], error: null };
        status = (q.value as { status: string }).status;
        return { data: [{ id: PROPOSAL_ID }], error: null };
      }
      if (q.table === "activity_proposals" && q.op === "select") return { data: { status }, error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client as never;
  }

  const tripWrites = () => log.filter((q) => q.table === "trips" && q.op === "update");
  const resolution = { method: "consensus" as const, resolvedBy: null };

  beforeEach(() => {
    trip = { itinerary: days(), itinerary_version: 7 };
    status = "voting";
    bumpBeforeWrite = false;
    failStatusWrite = false;
  });

  it("adds the activity on its day, compare-and-set, then marks the proposal approved", async () => {
    expect(await approveProposal(admin(), proposal(1), { method: "owner_override", resolvedBy: "owner-1" })).toEqual({ ok: true });
    expect(names(trip.itinerary, 1)).toContain("Rooftop bar");
    expect(trip.itinerary_version).toBe(8);
    expect(tripWrites()[0].filters).toContainEqual(["eq", "itinerary_version", 7]);
    const statusWrite = log.find((q) => q.table === "activity_proposals" && q.op === "update")!;
    expect(statusWrite.value).toMatchObject({ status: "approved", resolved_by: "owner-1", resolution_method: "owner_override" });
    expect(statusWrite.filters).toContainEqual(["in", "status", ["pending", "voting"]]);
    // The itinerary is written before the status.
    expect(log.indexOf(tripWrites()[0])).toBeLessThan(log.indexOf(statusWrite));
  });

  it("keeps a trip mate's save made meanwhile, and adds the activity on top of it", async () => {
    bumpBeforeWrite = true;
    expect(await approveProposal(admin(), proposal(2), resolution)).toEqual({ ok: true });
    expect(names(trip.itinerary, 2)).toEqual(["Rooftop bar", "Hike", "Their dinner"]);
    expect(trip.itinerary_version).toBe(9);
  });

  it("a retry after the status write failed adds nothing the second time", async () => {
    failStatusWrite = true;
    expect(await approveProposal(admin(), proposal(1), resolution)).toEqual({ ok: false, reason: "error" });
    expect(status).toBe("voting");

    failStatusWrite = false;
    expect(await approveProposal(admin(), proposal(1), resolution)).toEqual({ ok: true });
    expect(tripWrites()).toHaveLength(0);
    expect(names(trip.itinerary, 1).filter((n) => n === "Rooftop bar")).toHaveLength(1);
    expect(status).toBe("approved");
  });

  it("an approval racing another one finds it approved and still reports success", async () => {
    expect(await approveProposal(admin(), proposal(1), resolution)).toEqual({ ok: true });
    // The second request saw the proposal open before the first one landed.
    expect(await approveProposal(admin(), proposal(1), resolution)).toEqual({ ok: true });
    expect(tripWrites()).toHaveLength(0);
    expect(names(trip.itinerary, 1).filter((n) => n === "Rooftop bar")).toHaveLength(1);
  });

  it("leaves the trip and the proposal alone when the day is gone", async () => {
    expect(await approveProposal(admin(), proposal(9), resolution)).toEqual({ ok: false, reason: "no_day" });
    expect(tripWrites()).toHaveLength(0);
    expect(log.some((q) => q.table === "activity_proposals")).toBe(false);
    expect(status).toBe("voting");
  });

  it("does not approve a proposal resolved some other way meanwhile", async () => {
    status = "rejected";
    expect(await approveProposal(admin(), proposal(1), resolution)).toEqual({ ok: false, reason: "resolved" });
    expect(status).toBe("rejected");
  });
});
