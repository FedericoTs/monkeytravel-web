/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The trip page re-reads the itinerary when a proposal is approved, so the
 * hook must report the approval: from realtime with the row as it is now (the
 * cached copy still reads "voting"), and from this tab's own approve or
 * deciding vote, in case realtime is down.
 */

type Handler = (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void;
const handlers: Record<string, Handler> = {};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel = {
      on: (_kind: string, filter: { table: string }, handler: Handler) => {
        handlers[filter.table] = handler;
        return channel;
      },
      subscribe: () => channel,
    };
    return { channel: () => channel, removeChannel: () => undefined };
  },
}));

import { useProposals } from "./useProposals";

const OPEN = {
  id: "p1",
  trip_id: "t1",
  proposed_by: "mate-1",
  type: "new",
  activity_data: { name: "Rooftop bar", start_time: "09:00" },
  target_day: 1,
  status: "voting",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  expires_at: "2026-11-08T10:00:00Z",
  votes: [],
  vote_summary: { love: 0, flexible: 0, concerns: 0, no: 0, total: 0 },
};

function stubFetch(vote: Record<string, unknown> = { success: true, resolved: null }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify(vote), { status: 200 });
      if (init?.method === "PATCH") return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify({ proposals: [OPEN], totalVoters: 3 }), { status: 200 });
    })
  );
}

async function mount() {
  const onProposalChange = vi.fn();
  const hook = renderHook(() => useProposals({ tripId: "t1", onProposalChange }));
  await waitFor(() => expect(hook.result.current.proposals).toHaveLength(1));
  return { ...hook, onProposalChange };
}

beforeEach(() => stubFetch());
afterEach(() => vi.unstubAllGlobals());

describe("useProposals reports approvals", () => {
  it("a realtime approval arrives as approved, not as the open copy in the list", async () => {
    const { onProposalChange } = await mount();
    act(() => handlers.activity_proposals({ eventType: "UPDATE", new: { id: "p1", status: "approved", target_day: 1 }, old: { id: "p1" } }));
    expect(onProposalChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", status: "approved", target_day: 1, activity_data: OPEN.activity_data })
    );
  });

  it("a deleted proposal reports nothing", async () => {
    const { onProposalChange } = await mount();
    act(() => handlers.activity_proposals({ eventType: "DELETE", new: {}, old: { id: "p1" } }));
    expect(onProposalChange).not.toHaveBeenCalled();
  });

  it("the owner's approve reports it without waiting for realtime", async () => {
    const { result, onProposalChange } = await mount();
    await act(() => result.current.forceResolve("p1", "approve"));
    expect(onProposalChange).toHaveBeenCalledTimes(1);
    expect(onProposalChange).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", status: "approved" }));
  });

  it("a vote reports an approval only when it decided one", async () => {
    const { result, onProposalChange } = await mount();
    await act(() => result.current.voteOnProposal("p1", "love"));
    expect(onProposalChange).not.toHaveBeenCalled();

    stubFetch({ success: true, resolved: "approved" });
    await act(() => result.current.voteOnProposal("p1", "love"));
    expect(onProposalChange).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", status: "approved" }));
  });
});

describe("the day a proposal shows under", () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");

  it("is its target_day, read as the day's number everywhere", () => {
    const page = read("app/[locale]/(app)/trips/[id]/TripDetailClient.tsx");
    const sheet = read("components/collaboration/proposals/VotingBottomSheet.tsx");
    expect(page).toContain("proposals.filter(p => p.target_day === dayNumber)");
    expect(sheet).toContain("t('day', { day: proposal.target_day })");
    for (const source of [page, sheet, read("app/api/trips/[id]/proposals/route.ts")]) {
      expect(source).not.toMatch(/target_?[dD]ay\s*[+-]\s*1/);
    }
  });
});
