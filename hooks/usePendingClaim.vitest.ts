import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PendingClaim } from "@/lib/trips/anonymous-claim-client";

const readPendingClaim = vi.fn();
const claimPendingTrip = vi.fn();
const readClaimedTrip = vi.fn();
const bannerEvent = vi.fn();
vi.mock("@/lib/trips/anonymous-claim-client", () => ({
  readPendingClaim: () => readPendingClaim(),
  claimPendingTrip: () => claimPendingTrip(),
}));
vi.mock("@/lib/trips/claimed-trip-signal", () => ({ readClaimedTrip: () => readClaimedTrip() }));
vi.mock("@/lib/posthog/events", () => ({ capturePendingClaimBanner: (...a: unknown[]) => bannerEvent(...a) }));

import { usePendingClaim } from "./usePendingClaim";

const shared: PendingClaim = {
  tripId: "shared-1",
  shareToken: "tok",
  shareUrl: "https://example.com/shared/tok",
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-14",
  days: 5,
  createdAt: "2027-05-01T00:00:00.000Z",
};

type Props = Parameters<typeof usePendingClaim>[0];
const setClaimedTripId = vi.fn();
const setSavedTripId = vi.fn();
const openKeepAuth = vi.fn();
const props = (over: Partial<Props> = {}): Props => ({
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-14",
  isAuthenticated: null,
  generatedItinerary: null,
  step: 1,
  claimedTripId: null,
  setClaimedTripId,
  setSavedTripId,
  openKeepAuth,
  ...over,
});

beforeEach(() => {
  [readPendingClaim, claimPendingTrip, readClaimedTrip, bannerEvent, setClaimedTripId, setSavedTripId, openKeepAuth].forEach((fn) =>
    fn.mockReset()
  );
  readPendingClaim.mockResolvedValue(null);
  readClaimedTrip.mockReturnValue(null);
});

describe("usePendingClaim", () => {
  it("holds auto-save back while the shared trip is on screen and its claim is unresolved", async () => {
    readPendingClaim.mockResolvedValue(shared);
    const { result, rerender } = renderHook((p: Props) => usePendingClaim(p), { initialProps: props() });
    await waitFor(() => expect(result.current.pendingClaim).toEqual(shared));
    expect(result.current.deferAutoSave).toBe(true);
    rerender(props({ destination: "Porto, Portugal" }));
    expect(result.current.deferAutoSave).toBe(false);
  });

  it("claims the shared trip once signed in, and adopts it as the saved trip", async () => {
    readPendingClaim.mockResolvedValue(shared);
    claimPendingTrip.mockResolvedValue("shared-1");
    const { result, rerender } = renderHook((p: Props) => usePendingClaim(p), { initialProps: props() });
    await waitFor(() => expect(result.current.pendingClaim).not.toBeNull());
    rerender(props({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.adoptedTripId).toBe("shared-1"));
    expect(setSavedTripId).toHaveBeenCalledWith("shared-1");
    expect(setClaimedTripId).toHaveBeenCalledWith("shared-1");
    expect(result.current.deferAutoSave).toBe(false);
    expect(result.current.pendingClaim).toBeNull();
    expect(claimPendingTrip).toHaveBeenCalledTimes(1);
  });

  it("adopts a trip the sign-in already claimed, without asking again", async () => {
    readPendingClaim.mockResolvedValue(shared);
    const { result, rerender } = renderHook((p: Props) => usePendingClaim(p), { initialProps: props() });
    await waitFor(() => expect(result.current.pendingClaim).not.toBeNull());
    rerender(props({ claimedTripId: "shared-1" }));
    await waitFor(() => expect(result.current.adoptedTripId).toBe("shared-1"));
    expect(claimPendingTrip).not.toHaveBeenCalled();
  });

  it("hands saving back to auto-save when the claim comes back empty", async () => {
    readPendingClaim.mockResolvedValue(shared);
    claimPendingTrip.mockResolvedValue(null);
    const { result, rerender } = renderHook((p: Props) => usePendingClaim(p), { initialProps: props() });
    await waitFor(() => expect(result.current.pendingClaim).not.toBeNull());
    rerender(props({ isAuthenticated: true }));
    await waitFor(() => expect(result.current.pendingClaim).toBeNull());
    expect(result.current.deferAutoSave).toBe(false);
    expect(result.current.adoptedTripId).toBeNull();
    expect(setSavedTripId).not.toHaveBeenCalled();
  });

  it("keeps one share link for every share button, and waits on its claim", () => {
    const { result } = renderHook((p: Props) => usePendingClaim(p), { initialProps: props({ isAuthenticated: false }) });
    act(() => result.current.handleAnonShared(shared));
    expect(result.current.sessionShareUrl).toBe(shared.shareUrl);
    expect(result.current.deferAutoSave).toBe(true);
  });

  it("offers the shared trip on a signed-out step 1, and passes on Keep and Dismiss", async () => {
    readPendingClaim.mockResolvedValue(shared);
    const { result } = renderHook((p: Props) => usePendingClaim(p), { initialProps: props({ isAuthenticated: false }) });
    await waitFor(() => expect(result.current.showPendingClaimBanner).toBe(true));
    expect(bannerEvent).toHaveBeenCalledWith({ action: "surfaced", destination: shared.destination, trip_id: "shared-1" });
    act(() => result.current.handlePendingClaimAction("keep"));
    expect(openKeepAuth).toHaveBeenCalledWith("pending_claim");
    act(() => result.current.handlePendingClaimAction("dismissed"));
    expect(result.current.showPendingClaimBanner).toBe(false);
    expect(bannerEvent.mock.calls.filter(([e]) => e.action === "surfaced")).toHaveLength(1);
  });
});
