import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import { useKeptTripPlacesToEat } from "./useKeptTripPlacesToEat";

/**
 * The trip page's side of the check on a kept trip's places to eat: asked once
 * per opened trip when due, the server's changes made on the page's copy, and
 * what the page says of a check made just now.
 */

const NOTE = { checkedAt: "2026-11-06T18:00:00.000Z", checked: 8, changed: 1 };
const CHANGES = [{ day: 1, name: "Arkhe", to: null }];

const fetchMock = vi.fn();
const adoptDayWrite = vi.fn(async () => {});
const runItineraryWrite = vi.fn(async <T,>(task: () => Promise<T>) => task());

const answer = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });
const open = (due = true, tripId = "t1") =>
  renderHook((props: { due: boolean; tripId: string }) => useKeptTripPlacesToEat({ ...props, runItineraryWrite, adoptDayWrite }), {
    initialProps: { due, tripId },
  });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  adoptDayWrite.mockClear();
  runItineraryWrite.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("useKeptTripPlacesToEat", () => {
  it("asks nothing when the check isn't due, and has nothing to say", () => {
    const { result } = open(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("asks for this trip's check once, as one of the tab's server writes that keeps local edits", async () => {
    answer({ status: "none" });
    const { rerender } = open();
    rerender({ due: true, tripId: "t1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/t1/places-to-eat", { method: "POST" });
    expect(runItineraryWrite).toHaveBeenCalledWith(expect.any(Function), { keepsLocalEdits: true });
  });

  it("doesn't ask again when the same trip goes off due and comes back", async () => {
    answer({ status: "none" });
    const { rerender } = open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ due: false, tripId: "t1" });
    rerender({ due: true, tripId: "t1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again for another trip", async () => {
    answer({ status: "none" });
    const { rerender } = open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ due: true, tripId: "t2" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/trips/t2/places-to-eat", { method: "POST" });
  });

  it("makes the server's changes on the page's copy, from the version the server wrote them on", async () => {
    answer({ status: "checked", changes: CHANGES, fromVersion: 3, itineraryVersion: 4, note: NOTE });
    const { result } = open();
    await waitFor(() => expect(result.current).toEqual(NOTE));
    await waitFor(() => expect(adoptDayWrite).toHaveBeenCalledTimes(1));
    const [splice, from, to] = adoptDayWrite.mock.calls[0] as unknown as [(it: ItineraryDay[]) => ItineraryDay[], number, number];
    expect([from, to]).toEqual([3, 4]);
    const day = { day_number: 1, activities: [{ name: "Arkhe" }, { name: "Museum" }] } as unknown as ItineraryDay;
    expect(splice([day])[0].activities.map((a) => a.name)).toEqual(["Museum"]);
  });

  it("says a check with nothing to change was made, and writes nothing", async () => {
    answer({ status: "checked", changes: [], fromVersion: 3, itineraryVersion: 3, note: { ...NOTE, changed: 0 } });
    const { result } = open();
    await waitFor(() => expect(result.current).toEqual({ ...NOTE, changed: 0 }));
    expect(adoptDayWrite).not.toHaveBeenCalled();
  });

  it("says nothing of a trip with no place to eat to look up", async () => {
    answer({ status: "checked", changes: [], fromVersion: 3, itineraryVersion: 3, note: { ...NOTE, checked: 0, changed: 0 } });
    const { result } = open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(runItineraryWrite).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("reads nothing from a failed answer, whatever it holds", async () => {
    answer({ status: "checked", changes: CHANGES, fromVersion: 3, itineraryVersion: 4, note: NOTE }, false);
    const { result } = open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
    expect(adoptDayWrite).not.toHaveBeenCalled();
  });

  it("a request that can't be made is handled, so it's nobody's error", () => {
    const failed = Promise.reject(new TypeError("offline"));
    const handled = vi.spyOn(failed, "catch");
    runItineraryWrite.mockReturnValueOnce(failed as never);
    open();
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("says nothing when nothing was stored, or the request failed", async () => {
    answer({ status: "none", changes: CHANGES, note: NOTE });
    const none = open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(none.result.current).toBeNull();
    expect(adoptDayWrite).not.toHaveBeenCalled();

    answer({}, false);
    const failed = open(true, "t2");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(failed.result.current).toBeNull();

    fetchMock.mockRejectedValue(new TypeError("offline"));
    const offline = open(true, "t3");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(offline.result.current).toBeNull();
  });
});
