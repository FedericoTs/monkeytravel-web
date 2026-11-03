import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { CrewShareNudge, CrewVotePill, CrewVotesSummary, useCrewVotes, type CrewVotes } from "./CrewVotes";
import { fetchShareStatus } from "@/lib/trips/share-status";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/trips/share-status", () => ({ fetchShareStatus: vi.fn() }));

const shareStatus = vi.mocked(fetchShareStatus);
const VOTES: CrewVotes = { total: 3, voters: ["Ana", "Ben"], byActivity: { a1: { up: 2, down: 1 }, a2: { up: 0, down: 0 } } };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(VOTES), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useCrewVotes", () => {
  it("loads the crew's votes for the owner of a shared trip", async () => {
    shareStatus.mockResolvedValue({ isShared: true } as Awaited<ReturnType<typeof fetchShareStatus>>);
    const { result } = renderHook(() => useCrewVotes("t1", true));
    await waitFor(() => expect(result.current.votes).toEqual(VOTES));
    expect(result.current.sharingEnabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/t1/crew-votes");
  });

  it("knows a trip was never shared, and reads no votes for it", async () => {
    shareStatus.mockResolvedValue({ isShared: false } as Awaited<ReturnType<typeof fetchShareStatus>>);
    const { result } = renderHook(() => useCrewVotes("t1", true));
    await waitFor(() => expect(result.current.sharingEnabled).toBe(false));
    expect(result.current.votes).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads nothing for anyone but the owner", () => {
    const { result } = renderHook(() => useCrewVotes("t1", false));
    expect(result.current).toEqual({ sharingEnabled: null, votes: null });
    expect(shareStatus).not.toHaveBeenCalled();
  });

  it("leaves the votes out when they can't be read", async () => {
    shareStatus.mockResolvedValue({ isShared: true } as Awaited<ReturnType<typeof fetchShareStatus>>);
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useCrewVotes("t1", true));
    await waitFor(() => expect(result.current.sharingEnabled).toBe(true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.votes).toBeNull();
    warn.mockRestore();
  });
});

describe("CrewVotePill", () => {
  it("shows an activity's votes", () => {
    render(<CrewVotePill votes={VOTES} activityId="a1" />);
    expect(screen.getByText("👍2")).toBeTruthy();
    expect(screen.getByText("👎1")).toBeTruthy();
  });

  it("shows nothing for an activity with no votes, or none loaded", () => {
    const { container: zero } = render(<CrewVotePill votes={VOTES} activityId="a2" />);
    const { container: missing } = render(<CrewVotePill votes={VOTES} activityId="a3" />);
    const { container: none } = render(<CrewVotePill votes={null} activityId="a1" />);
    const { container: noId } = render(<CrewVotePill votes={VOTES} activityId={undefined} />);
    for (const c of [zero, missing, none, noId]) expect(c.innerHTML).toBe("");
  });
});

describe("CrewVotesSummary", () => {
  it("counts the votes, names the voters and asks for more", () => {
    const onShare = vi.fn();
    render(<CrewVotesSummary votes={VOTES} onShare={onShare} />);
    expect(screen.getByText('detail.crewVotesSummary {"count":3}')).toBeTruthy();
    expect(screen.getByText('detail.crewVotesVoters {"names":"Ana, Ben"}')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "detail.crewVotesShare" }));
    expect(onShare).toHaveBeenCalledOnce();
  });

  it("names no one when no voter gave a name", () => {
    render(<CrewVotesSummary votes={{ ...VOTES, voters: [] }} onShare={() => {}} />);
    expect(screen.queryByText(/crewVotesVoters/)).toBeNull();
  });
});

describe("CrewShareNudge", () => {
  it("asks to send the trip, and stays dismissed for that trip", () => {
    const onShare = vi.fn();
    const { unmount } = render(<CrewShareNudge tripId="t1" onShare={onShare} />);
    fireEvent.click(screen.getByRole("button", { name: "detail.crewCtaButton" }));
    expect(onShare).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "detail.crewCtaDismiss" }));
    expect(screen.queryByText("detail.crewCtaText")).toBeNull();
    expect(localStorage.getItem("crewCtaDismissed:t1")).toBe("1");
    unmount();

    render(<CrewShareNudge tripId="t1" onShare={onShare} />);
    expect(screen.queryByText("detail.crewCtaText")).toBeNull();
    render(<CrewShareNudge tripId="t2" onShare={onShare} />);
    expect(screen.getByText("detail.crewCtaText")).toBeTruthy();
  });

  it("stays hidden for a trip dismissed before", () => {
    localStorage.setItem("crewCtaDismissed:t1", "1");
    render(<CrewShareNudge tripId="t1" onShare={() => {}} />);
    expect(screen.queryByText("detail.crewCtaText")).toBeNull();
  });
});
