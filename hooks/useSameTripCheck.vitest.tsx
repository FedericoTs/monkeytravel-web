import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSameTripCheck } from "./useSameTripCheck";
import { findRecentTwin } from "@/lib/trips/recent-twin";

const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));
vi.mock("@/lib/trips/recent-twin", () => ({ findRecentTwin: vi.fn() }));
const lookup = vi.mocked(findRecentTwin);

const PARIS = { destination: "Paris, France", startDate: "2027-05-10", endDate: "2027-05-12" };
const TWIN = { id: "trip-1", title: "Paris" };

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("useSameTripCheck", () => {
  it("checks nothing and holds nothing up without a trip", () => {
    const { result } = renderHook(() => useSameTripCheck(null, true));
    expect(result.current).toMatchObject({ twin: null, awaiting: false, replaceTripId: null });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("holds the plan up while the check is out", async () => {
    let answer: (twin: typeof TWIN | null) => void = () => {};
    lookup.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useSameTripCheck(PARIS, true));
    expect(result.current.awaiting).toBe(true);
    await waitFor(() => expect(lookup).toHaveBeenCalledWith(expect.anything(), "u1", PARIS));
    await act(async () => answer(null));
    expect(result.current).toMatchObject({ twin: null, awaiting: false });
  });

  it("starts with the generation but holds nothing up before the plan shows", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result, rerender } = renderHook(({ hasPlan }) => useSameTripCheck(PARIS, hasPlan), {
      initialProps: { hasPlan: false },
    });
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    expect(result.current.awaiting).toBe(false);
    rerender({ hasPlan: true });
    expect(result.current.awaiting).toBe(true);
  });

  it("waits for the planner's answer when the trip is saved already", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result } = renderHook(() => useSameTripCheck(PARIS, true));
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    expect(result.current.awaiting).toBe(true);

    act(() => result.current.choose("trip-1"));
    expect(result.current).toMatchObject({ awaiting: false, replaceTripId: "trip-1" });
  });

  it("saves a separate trip when the planner says so", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result } = renderHook(() => useSameTripCheck(PARIS, true));
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    act(() => result.current.choose(null));
    expect(result.current).toMatchObject({ awaiting: false, replaceTripId: null });
  });

  it("asks again for other dates: an answer holds for its own trip only", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result, rerender } = renderHook(({ trip }) => useSameTripCheck(trip, true), {
      initialProps: { trip: PARIS },
    });
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    act(() => result.current.choose("trip-1"));

    rerender({ trip: { ...PARIS, endDate: "2027-05-14" } });
    expect(result.current).toMatchObject({ twin: null, awaiting: true, replaceTripId: null });
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    expect(result.current.awaiting).toBe(true);
  });

  it("lets the save go ahead when the check fails, or nobody is signed in", async () => {
    lookup.mockRejectedValue(new Error("network"));
    const failed = renderHook(() => useSameTripCheck(PARIS, true));
    await waitFor(() => expect(failed.result.current.awaiting).toBe(false));
    expect(failed.result.current.twin).toBeNull();

    getSession.mockResolvedValue({ data: { session: null } });
    lookup.mockClear();
    const signedOut = renderHook(() => useSameTripCheck(PARIS, true));
    await waitFor(() => expect(signedOut.result.current.awaiting).toBe(false));
    expect(lookup).not.toHaveBeenCalled();
  });

  it("needs a destination and both dates", () => {
    for (const trip of [{ ...PARIS, destination: "" }, { ...PARIS, startDate: "" }, { ...PARIS, endDate: "" }]) {
      const { result } = renderHook(() => useSameTripCheck(trip, true));
      expect(result.current.awaiting).toBe(false);
    }
    expect(getSession).not.toHaveBeenCalled();
  });
});
