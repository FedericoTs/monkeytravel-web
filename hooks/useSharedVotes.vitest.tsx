/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useSharedVotes } from "./useSharedVotes";

/**
 * Voting on a shared trip without an account: what the page reads, what a vote
 * answers, and what the voter is told when it doesn't land.
 */

const addToast = vi.hoisted(() => vi.fn());
const haptics = vi.hoisted(() => ({ hapticMedium: vi.fn(), hapticError: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/lib/native/haptics", () => haptics);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const answer = (activity_id: string, up: number, down: number, myVote: "up" | "down" | null) => json({ activity_id, up, down, myVote });

/** Answers the read with `votes` and each vote with `onVote`; returns what was posted. */
function serve(onVote: () => Response | Promise<Response>, votes: Record<string, unknown> = { tallies: {}, myVotes: {} }) {
  const posted: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "GET") return json(votes);
    posted.push({ url, ...JSON.parse(String(init?.body)) });
    return onVote();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posted, fetchMock };
}

const open = (props: { shareToken?: string; isOwner?: boolean } = { shareToken: "tok" }) => renderHook(() => useSharedVotes(props));
const settle = () => act(async () => {});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  addToast.mockClear();
  haptics.hapticMedium.mockClear();
  haptics.hapticError.mockClear();
});

describe("opening the page", () => {
  it("reads the tallies and this viewer's votes through the share link", async () => {
    const { fetchMock } = serve(() => json({}), { tallies: { a1: { up: 2, down: 1 } }, myVotes: { a1: "up" } });
    const { result } = open();
    await waitFor(() => expect(result.current.voteTallies).toEqual({ a1: { up: 2, down: 1 } }));
    expect(result.current.myVotes).toEqual({ a1: "up" });
    expect(fetchMock).toHaveBeenCalledWith("/api/shared/tok/votes", expect.objectContaining({ method: "GET" }));
  });

  it("doesn't ask for a name again from someone who has voted before", async () => {
    serve(() => json({}), { tallies: {}, myVotes: { a1: "up" } });
    const { result } = open();
    await waitFor(() => expect(result.current.hasDisplayName).toBe(true));
  });

  it("asks a first-time voter for a name", async () => {
    serve(() => json({}));
    const { result } = open();
    await settle();
    expect(result.current.hasDisplayName).toBe(false);
  });

  it("reads nothing with no share link", async () => {
    const { fetchMock } = serve(() => json({}));
    open({});
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still works when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Load failed"))));
    const { result } = open();
    await settle();
    expect(result.current.voteTallies).toEqual({});
  });

  it("keeps the empty state when the read is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ tallies: { a1: { up: 9, down: 9 } } }, 500)));
    const { result } = open();
    await settle();
    expect(result.current.voteTallies).toEqual({});
  });
});

describe("voting", () => {
  it("posts the vote and shows what the server counted", async () => {
    const { posted } = serve(() => answer("a1", 3, 1, "up"));
    const { result } = open();
    await settle();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: "up", displayName: "Ana" }));
    expect(posted).toEqual([{ url: "/api/shared/tok/vote", activity_id: "a1", vote_type: "up", display_name: "Ana" }]);
    expect(result.current.voteTallies.a1).toEqual({ up: 3, down: 1 });
    expect(result.current.myVotes.a1).toBe("up");
    expect(result.current.hasDisplayName).toBe(true);
    expect(result.current.pendingVoteId).toBeNull();
    expect(haptics.hapticMedium).toHaveBeenCalledTimes(1);
  });

  it("sends no name it wasn't given", async () => {
    const { posted } = serve(() => answer("a1", 1, 0, "up"));
    const { result } = open();
    await settle();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: "up", displayName: "" }));
    expect(posted[0]).not.toHaveProperty("display_name");
  });

  it("shows the vote as pending while it travels", async () => {
    let land: (r: Response) => void = () => {};
    serve(() => new Promise<Response>((resolve) => (land = resolve)));
    const { result } = open();
    await settle();
    let vote: Promise<void> = Promise.resolve();
    act(() => {
      vote = result.current.handleVote({ activityId: "a1", voteType: "up" });
    });
    expect(result.current.pendingVoteId).toBe("a1");
    await act(async () => {
      land(answer("a1", 1, 0, "up"));
      await vote;
    });
    expect(result.current.pendingVoteId).toBeNull();
  });

  it("taking a vote back forgets it, and leaves the others", async () => {
    serve(() => answer("a1", 0, 0, null), { tallies: {}, myVotes: { a1: "up", a2: "down" } });
    const { result } = open();
    await waitFor(() => expect(result.current.myVotes.a1).toBe("up"));
    await act(() => result.current.handleVote({ activityId: "a1", voteType: null }));
    expect(result.current.myVotes).toEqual({ a2: "down" });
  });
});

describe("the nudge after a guest's first vote", () => {
  it("shows under that activity, once a visit", async () => {
    serve(() => answer("a1", 1, 0, "up"));
    const { result } = open();
    await settle();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: "up" }));
    expect(result.current.afterVoteId).toBe("a1");
    act(() => result.current.dismissAfterVote());
    expect(result.current.afterVoteId).toBeNull();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: "up" }));
    expect(result.current.afterVoteId).toBeNull();
  });

  it("doesn't show for the trip's owner", async () => {
    serve(() => answer("a1", 1, 0, "up"));
    const { result } = open({ shareToken: "tok", isOwner: true });
    await settle();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: "up" }));
    expect(result.current.afterVoteId).toBeNull();
  });

  it("doesn't show for a vote taken back", async () => {
    serve(() => answer("a1", 0, 0, null));
    const { result } = open();
    await settle();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: null }));
    expect(result.current.afterVoteId).toBeNull();
  });
});

describe("a vote that doesn't land", () => {
  const voteWith = async (onVote: () => Response | Promise<Response>) => {
    serve(onVote);
    const { result } = open();
    await settle();
    await act(() => result.current.handleVote({ activityId: "a1", voteType: "up" }));
    return result;
  };

  it("over the limit, asks for a moment", async () => {
    const result = await voteWith(() => json({}, 429));
    expect(addToast).toHaveBeenCalledWith("shared.rateLimit", "warning");
    expect(haptics.hapticError).toHaveBeenCalledTimes(1);
    expect(result.current.myVotes).toEqual({});
  });

  it.each([400, 500])("refused with %i, says it failed", async (status) => {
    const result = await voteWith(() => json({}, status));
    expect(addToast).toHaveBeenCalledWith("shared.voteFailed", "error");
    expect(result.current.pendingVoteId).toBeNull();
  });

  it("with a dropped connection, says to check it", async () => {
    await voteWith(() => Promise.reject(new TypeError("Load failed")));
    expect(addToast).toHaveBeenCalledWith("shared.networkError", "error");
    expect(haptics.hapticError).toHaveBeenCalledTimes(1);
  });
});
