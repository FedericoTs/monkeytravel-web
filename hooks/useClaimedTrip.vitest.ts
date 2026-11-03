import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

const readClaimedTrip = vi.fn();
const clearClaimedTrip = vi.fn();
let publish: ((id: string) => void) | null = null;
const claimPendingTrip = vi.fn();
const bannerEvent = vi.fn();
vi.mock("@/lib/trips/claimed-trip-signal", () => ({
  readClaimedTrip: () => readClaimedTrip(),
  clearClaimedTrip: () => clearClaimedTrip(),
  onClaimedTrip: (fn: (id: string) => void) => {
    publish = fn;
    return () => {
      publish = null;
    };
  },
}));
vi.mock("@/lib/trips/anonymous-claim-client", () => ({ claimPendingTrip: () => claimPendingTrip() }));
vi.mock("@/lib/posthog/events", () => ({ captureClaimedTripBanner: (...a: unknown[]) => bannerEvent(...a) }));

import { useClaimedTrip } from "./useClaimedTrip";

type Props = Parameters<typeof useClaimedTrip>[0];
const user = { id: "u1" } as User;
const props = (over: Partial<Props> = {}): Props => ({ isFreshSignup: false, authLoading: false, authUser: null, ...over });

beforeEach(() => {
  [readClaimedTrip, clearClaimedTrip, claimPendingTrip, bannerEvent].forEach((fn) => fn.mockReset());
  readClaimedTrip.mockReturnValue(null);
  publish = null;
});

describe("useClaimedTrip", () => {
  it("shows a trip claimed before it mounted, and one claimed after", () => {
    readClaimedTrip.mockReturnValue("t1");
    const { result } = renderHook((p: Props) => useClaimedTrip(p), { initialProps: props() });
    expect(result.current.claimedTripId).toBe("t1");
    act(() => publish?.("t2"));
    expect(result.current.claimedTripId).toBe("t2");
    expect(bannerEvent.mock.calls.map(([e]) => [e.action, e.trip_id])).toEqual([
      ["surfaced", "t1"],
      ["surfaced", "t2"],
    ]);
  });

  it("claims directly, once, on the first visit after signing up", async () => {
    claimPendingTrip.mockResolvedValue("t3");
    const { result, rerender } = renderHook((p: Props) => useClaimedTrip(p), {
      initialProps: props({ isFreshSignup: true, authLoading: true }),
    });
    expect(claimPendingTrip).not.toHaveBeenCalled();
    rerender(props({ isFreshSignup: true, authUser: user }));
    await waitFor(() => expect(result.current.claimedTripId).toBe("t3"));
    rerender(props({ isFreshSignup: true, authUser: { id: "u1" } as User }));
    // The claim runs once its module has loaded: let that settle first.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(claimPendingTrip).toHaveBeenCalledTimes(1);
  });

  it("does not claim on an ordinary visit", () => {
    renderHook((p: Props) => useClaimedTrip(p), { initialProps: props({ authUser: user }) });
    expect(claimPendingTrip).not.toHaveBeenCalled();
  });

  it("closes the banner with the planner's choice", () => {
    readClaimedTrip.mockReturnValue("t1");
    const { result } = renderHook((p: Props) => useClaimedTrip(p), { initialProps: props() });
    act(() => result.current.dismissClaimedTrip("plan_another"));
    expect(result.current.claimedTripId).toBeNull();
    expect(clearClaimedTrip).toHaveBeenCalledTimes(1);
    expect(bannerEvent).toHaveBeenLastCalledWith({ action: "plan_another", trip_id: "t1" });
  });
});
