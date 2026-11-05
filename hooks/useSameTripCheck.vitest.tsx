import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSameTripCheck } from "./useSameTripCheck";
import { findRecentTwin } from "@/lib/trips/recent-twin";
import { savedTripOf } from "@/lib/wizard/draft-saved-check";
import type { GeneratedItinerary } from "@/types";

const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));
vi.mock("@/lib/trips/recent-twin", () => ({ findRecentTwin: vi.fn() }));
vi.mock("@/lib/wizard/draft-saved-check", () => ({ savedTripOf: vi.fn() }));
const lookup = vi.mocked(findRecentTwin);
const holder = vi.mocked(savedTripOf);
const PLAN = { days: [] } as unknown as GeneratedItinerary;

const PARIS = { destination: "Paris, France", startDate: "2027-05-10", endDate: "2027-05-12" };
const TWIN = { id: "trip-1", title: "Paris" };

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
  holder.mockResolvedValue(null);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("useSameTripCheck", () => {
  it("checks nothing and holds nothing up without a trip", () => {
    const { result } = renderHook(() => useSameTripCheck(null, PLAN));
    expect(result.current).toMatchObject({ twin: null, awaiting: false, replaceTripId: null });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("holds the plan up while the check is out", async () => {
    let answer: (twin: typeof TWIN | null) => void = () => {};
    lookup.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
    expect(result.current.awaiting).toBe(true);
    await waitFor(() => expect(lookup).toHaveBeenCalledWith(expect.anything(), "u1", PARIS));
    await act(async () => answer(null));
    expect(result.current).toMatchObject({ twin: null, awaiting: false });
  });

  it("starts with the generation but holds nothing up before the plan shows", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result, rerender } = renderHook(({ plan }) => useSameTripCheck(PARIS, plan), {
      initialProps: { plan: null as GeneratedItinerary | null },
    });
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    expect(result.current.awaiting).toBe(false);
    rerender({ plan: PLAN });
    expect(result.current.awaiting).toBe(true);
  });

  it("waits for the planner's answer when the trip is saved already", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    expect(result.current.awaiting).toBe(true);

    act(() => result.current.choose("trip-1"));
    expect(result.current).toMatchObject({ awaiting: false, replaceTripId: "trip-1" });
  });

  it("asks again after the answer is dropped, as Start Over does", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    act(() => result.current.choose("trip-1"));
    act(() => result.current.forget());
    expect(result.current).toMatchObject({ awaiting: true, replaceTripId: null });
  });

  it("saves a separate trip when the planner says so", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
    await waitFor(() => expect(result.current.twin).toEqual(TWIN));
    act(() => result.current.choose(null));
    expect(result.current).toMatchObject({ awaiting: false, replaceTripId: null });
  });

  it("asks again for other dates: an answer holds for its own trip only", async () => {
    lookup.mockResolvedValue(TWIN);
    const { result, rerender } = renderHook(({ trip }) => useSameTripCheck(trip, PLAN), {
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
    const failed = renderHook(() => useSameTripCheck(PARIS, PLAN));
    await waitFor(() => expect(failed.result.current.awaiting).toBe(false));
    expect(failed.result.current.twin).toBeNull();

    getSession.mockResolvedValue({ data: { session: null } });
    lookup.mockClear();
    const signedOut = renderHook(() => useSameTripCheck(PARIS, PLAN));
    await waitFor(() => expect(signedOut.result.current.awaiting).toBe(false));
    expect(lookup).not.toHaveBeenCalled();
  });

  describe("when the trip found is this very plan", () => {
    it("asks nothing, and says which trip holds it", async () => {
      lookup.mockResolvedValue(TWIN);
      holder.mockResolvedValue("trip-1");
      const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
      await waitFor(() => expect(result.current.holdingTripId).toBe("trip-1"));
      expect(result.current).toMatchObject({ twin: null, awaiting: false, replaceTripId: null });
      expect(holder).toHaveBeenCalledWith(expect.anything(), "u1", PLAN);
    });

    it("holds the plan up without asking until it's known", async () => {
      lookup.mockResolvedValue(TWIN);
      let answer: (tripId: string | null) => void = () => {};
      holder.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
      await waitFor(() => expect(holder).toHaveBeenCalled());
      expect(result.current).toMatchObject({ twin: null, awaiting: true, holdingTripId: null });
      await act(async () => answer(null));
      expect(result.current).toMatchObject({ twin: TWIN, awaiting: true, holdingTripId: null });
    });

    it("still asks when another trip holds the plan, or none does", async () => {
      lookup.mockResolvedValue(TWIN);
      holder.mockResolvedValue("trip-9");
      const { result } = renderHook(() => useSameTripCheck(PARIS, PLAN));
      await waitFor(() => expect(result.current.twin).toEqual(TWIN));
      expect(result.current).toMatchObject({ awaiting: true, holdingTripId: null });
    });

    it("still asks when that can't be read, or nobody is signed in by then", async () => {
      lookup.mockResolvedValue(TWIN);
      holder.mockRejectedValue(new Error("network"));
      const failed = renderHook(() => useSameTripCheck(PARIS, PLAN));
      await waitFor(() => expect(failed.result.current.twin).toEqual(TWIN));

      holder.mockClear();
      getSession
        .mockResolvedValueOnce({ data: { session: { user: { id: "u1" } } } })
        .mockResolvedValueOnce({ data: { session: null } });
      const signedOut = renderHook(() => useSameTripCheck(PARIS, PLAN));
      await waitFor(() => expect(signedOut.result.current.twin).toEqual(TWIN));
      expect(holder).not.toHaveBeenCalled();
    });

    it("looks again for a new plan, and doesn't look before there is one", async () => {
      lookup.mockResolvedValue(TWIN);
      const { result, rerender } = renderHook(({ plan }) => useSameTripCheck(PARIS, plan), {
        initialProps: { plan: null as GeneratedItinerary | null },
      });
      await waitFor(() => expect(result.current.twin).toEqual(TWIN));
      expect(holder).not.toHaveBeenCalled();

      rerender({ plan: PLAN });
      await waitFor(() => expect(holder).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.twin).toEqual(TWIN));

      holder.mockResolvedValue("trip-1");
      rerender({ plan: { days: [] } as unknown as GeneratedItinerary });
      expect(result.current.twin).toBeNull();
      await waitFor(() => expect(result.current.holdingTripId).toBe("trip-1"));
    });
  });

  it("needs a destination and both dates", () => {
    for (const trip of [{ ...PARIS, destination: "" }, { ...PARIS, startDate: "" }, { ...PARIS, endDate: "" }]) {
      const { result } = renderHook(() => useSameTripCheck(trip, PLAN));
      expect(result.current.awaiting).toBe(false);
    }
    expect(getSession).not.toHaveBeenCalled();
  });
});
