import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const addToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string) => `${namespace}:${key}` }));

import { useVotingSheetActions } from "./useVotingSheetActions";

/**
 * The voting sheet's actions on the proposal it shows: vote, take the vote
 * back, and the owner's approve or reject, each confirmed in a toast; a
 * failure is said in a toast and throws, so the sheet stays open.
 */

function setup(proposal: { id: string } | null = { id: "p1" }, fail = false) {
  const call = () => vi.fn(async () => (fail ? Promise.reject(new Error("offline")) : undefined));
  const fns = { voteOnProposal: call(), removeVote: call(), forceResolve: call() };
  const { result } = renderHook(() => useVotingSheetActions({ proposal, ...fns }));
  return { actions: result.current, ...fns };
}

beforeEach(() => addToast.mockClear());
afterEach(cleanup);

describe("useVotingSheetActions", () => {
  it("sends a vote with its comment and confirms it", async () => {
    const { actions, voteOnProposal } = setup();
    await actions.onVote("love", "so good");
    expect(voteOnProposal).toHaveBeenCalledWith("p1", "love", "so good");
    expect(addToast.mock.calls).toEqual([["common:proposals.toasts.voteRecorded", "success"]]);
  });

  it("takes the vote back and confirms it", async () => {
    const { actions, removeVote } = setup();
    await actions.onRemoveVote();
    expect(removeVote).toHaveBeenCalledWith("p1");
    expect(addToast.mock.calls).toEqual([["common:proposals.toasts.voteRemoved", "success"]]);
  });

  it("confirms the owner's reject, and leaves an approval to be confirmed where approvals are", async () => {
    const { actions, forceResolve } = setup();
    await actions.onForceResolve("reject");
    expect(addToast.mock.calls).toEqual([["common:proposals.toasts.rejected", "success"]]);
    addToast.mockClear();
    await actions.onForceResolve("approve");
    expect(addToast).not.toHaveBeenCalled();
    expect(forceResolve.mock.calls).toEqual([
      ["p1", "reject"],
      ["p1", "approve"],
    ]);
  });

  it("says when the owner's approve or reject fails, and throws so the sheet stays open", async () => {
    const { actions } = setup({ id: "p1" }, true);
    await expect(actions.onForceResolve("reject")).rejects.toThrow("offline");
    expect(addToast.mock.calls).toEqual([["trips:detail.proposalActionFailed", "error"]]);
  });

  it("says when a vote or its removal fails, and throws so the sheet stays open", async () => {
    const { actions } = setup({ id: "p1" }, true);
    await expect(actions.onVote("love")).rejects.toThrow("offline");
    expect(addToast.mock.calls).toEqual([["trips:detail.proposalActionFailed", "error"]]);
    addToast.mockClear();
    await expect(actions.onRemoveVote()).rejects.toThrow("offline");
    expect(addToast.mock.calls).toEqual([["trips:detail.proposalActionFailed", "error"]]);
  });

  it("does nothing without a proposal", async () => {
    const { actions, voteOnProposal, removeVote, forceResolve } = setup(null);
    await actions.onVote("love");
    await actions.onRemoveVote();
    await actions.onForceResolve("reject");
    expect([voteOnProposal, removeVote, forceResolve].every((f) => f.mock.calls.length === 0)).toBe(true);
    expect(addToast).not.toHaveBeenCalled();
  });
});
