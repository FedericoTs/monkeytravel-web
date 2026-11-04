/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import { useKeptTripPlacesToEat } from "./useKeptTripPlacesToEat";

/**
 * A kept diet trip's places to eat are looked up on its owner's first open, as
 * one of the tab's server writes, and the page takes the changes the server
 * stored onto its own copy.
 */

const CHANGES = [{ day: 1, id: "a1", name: "Dinner at Arkhe", to: { id: "act_new", name: "Plant Base", type: "restaurant" } }];
const plan = [{ day_number: 1, activities: [{ id: "a1", name: "Dinner at Arkhe", type: "restaurant" }] }] as unknown as ItineraryDay[];

let fetchMock: ReturnType<typeof vi.fn>;
let runItineraryWrite: ReturnType<typeof vi.fn>;
let adoptDayWrite: ReturnType<typeof vi.fn>;
const answer = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

beforeEach(() => {
  fetchMock = vi.fn();
  answer({ status: "checked", changes: CHANGES, fromVersion: 4, itineraryVersion: 5 });
  vi.stubGlobal("fetch", fetchMock);
  runItineraryWrite = vi.fn(async (task: () => Promise<unknown>) => task());
  adoptDayWrite = vi.fn(async () => {});
});
afterEach(() => vi.unstubAllGlobals());

const open = (props: { due?: boolean; tripId?: string } = {}) =>
  renderHook((p: { due: boolean; tripId: string }) => useKeptTripPlacesToEat({ ...p, runItineraryWrite, adoptDayWrite } as never), {
    initialProps: { due: true, tripId: "trip-1", ...props },
  });

describe("useKeptTripPlacesToEat", () => {
  it("asks for the check in the save queue, and makes the stored changes to the page's copy", async () => {
    open();

    await waitFor(() => expect(adoptDayWrite).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1/places-to-eat", { method: "POST" });
    expect(runItineraryWrite).toHaveBeenCalledWith(expect.any(Function), { keepsLocalEdits: true });
    const [splice, from, to] = adoptDayWrite.mock.calls[0];
    expect([from, to]).toEqual([4, 5]);
    expect((splice as (it: ItineraryDay[]) => ItineraryDay[])(plan)[0].activities.map((a) => a.name)).toEqual(["Plant Base"]);
  });

  it("asks nothing when the check is not due", async () => {
    open({ due: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks once per opened trip, however often the page renders", async () => {
    const { rerender } = open();
    rerender({ due: true, tripId: "trip-1" });
    rerender({ due: false, tripId: "trip-1" });
    rerender({ due: true, tripId: "trip-1" });
    await waitFor(() => expect(adoptDayWrite).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ due: true, tripId: "trip-2" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/trips/trip-2/places-to-eat", { method: "POST" });
  });

  it("changes nothing when nothing was stored or nothing changed", async () => {
    answer({ status: "none" });
    open({ tripId: "trip-1" });
    answer({ status: "checked", changes: [], fromVersion: 4, itineraryVersion: 4 });
    open({ tripId: "trip-2" });
    answer({ error: "boom" }, false);
    open({ tripId: "trip-3" });

    await waitFor(() => expect(runItineraryWrite).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 0));
    expect(adoptDayWrite).not.toHaveBeenCalled();
  });

  it("stays quiet when the write cannot run", async () => {
    runItineraryWrite.mockRejectedValueOnce(new Error("blocked by a conflict"));
    open();
    await waitFor(() => expect(runItineraryWrite).toHaveBeenCalledTimes(1));
    expect(adoptDayWrite).not.toHaveBeenCalled();
  });
});
