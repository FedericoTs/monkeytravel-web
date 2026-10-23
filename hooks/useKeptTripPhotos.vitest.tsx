/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import { useKeptTripPhotos } from "./useKeptTripPhotos";

/**
 * A saved plan's photos are looked up when its owner opens it, not on each
 * planner save: once per opened trip, not again within ten minutes of the last
 * run, and only while an activity still shows a stand-in.
 */

const PHOTO = "/api/places/photo?name=places%2Fx%2Fphotos%2Fp&w=600&h=400";
const STOCK = "https://images.pexels.com/photos/1/a.jpeg";
const plan = (image_url?: string) => [{ day_number: 1, activities: [{ id: "a1", name: "Alpha", image_url }] }] as unknown as ItineraryDay[];
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ photos: { a1: PHOTO } }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const open = (opts: Partial<Parameters<typeof useKeptTripPhotos>[0]> = {}) => {
  const onPhotos = vi.fn();
  const hook = renderHook(() => useKeptTripPhotos({ enabled: true, tripId: "trip-1", itinerary: plan(STOCK), lastRun: undefined, onPhotos, ...opts }));
  return { onPhotos, ...hook };
};

describe("useKeptTripPhotos", () => {
  it("looks the photos up when the owner opens a trip with stand-ins, and hands them over", async () => {
    const { onPhotos } = open();
    await waitFor(() => expect(onPhotos).toHaveBeenCalledWith({ a1: PHOTO }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1/enrich-photos", { method: "POST" });
  });

  it("looks nothing up for someone else, a trip without stand-ins, or within ten minutes of the last run", async () => {
    open({ enabled: false });
    open({ itinerary: plan(PHOTO) });
    open({ lastRun: minutesAgo(3) });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs again after ten minutes, and for an activity with no photo at all", async () => {
    open({ lastRun: minutesAgo(30), itinerary: plan(undefined) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("does not hand photos to a page that was left", async () => {
    let answer!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { onPhotos, unmount } = open();
    unmount();
    answer({ ok: true, json: async () => ({ photos: { a1: PHOTO } }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(onPhotos).not.toHaveBeenCalled();
  });
});
