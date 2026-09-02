/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoSaveTrip, type UseAutoSaveTripOptions } from "./useAutoSaveTrip";
import type { GeneratedItinerary } from "@/types";

/**
 * A claimed anonymous share must become THE saved trip (2026-09-02).
 *
 * Before: the hook only knew "no saved id → insert". A trip row that already
 * held the itinerary (claimed by AuthProvider on sign-in) was invisible to it,
 * so the first authenticated render inserted a second copy. Two options fix
 * that: `deferred` parks the hook while the claim is unresolved, and
 * `adoptedTripId` hands it the row so later edits UPDATE instead of INSERT.
 */

const itineraryA = { destination: { name: "Lisbon" }, days: [{}, {}] } as unknown as GeneratedItinerary;
const itineraryB = { destination: { name: "Lisbon" }, days: [{}, {}, {}] } as unknown as GeneratedItinerary;

function harness(overrides: Partial<UseAutoSaveTripOptions> = {}) {
  const saveTrip = vi.fn(async () => ({ tripId: "inserted-1", durationDays: 2 }));
  const updateTrip = vi.fn(async () => undefined);
  const deleteTrip = vi.fn(async () => undefined);
  const onSkipped = vi.fn();
  const base: UseAutoSaveTripOptions = {
    itinerary: itineraryA,
    isAuthenticated: true,
    enabled: true,
    formState: { destination: "Lisbon", startDate: "2026-10-01", endDate: "2026-10-02" } as unknown as UseAutoSaveTripOptions["formState"],
    saveTrip,
    updateTrip,
    deleteTrip,
    onSkipped,
    retryDelaysMs: [],
    ...overrides,
  };
  const hook = renderHook((props: UseAutoSaveTripOptions) => useAutoSaveTrip(props), { initialProps: base });
  return { ...hook, base, saveTrip, updateTrip, onSkipped };
}

describe("useAutoSaveTrip: adopting a claimed trip", () => {
  it("adopts the id without inserting, then updates that row when the itinerary changes", async () => {
    const h = harness({ adoptedTripId: "claimed-9" });
    await waitFor(() => expect(h.result.current.savedTripId).toBe("claimed-9"));
    expect(h.result.current.status).toBe("saved");
    expect(h.saveTrip).not.toHaveBeenCalled();

    h.rerender({ ...h.base, adoptedTripId: "claimed-9", itinerary: itineraryB });
    await waitFor(() => expect(h.updateTrip).toHaveBeenCalledTimes(1));
    expect(h.updateTrip.mock.calls[0][0]).toBe("claimed-9");
    expect(h.saveTrip).not.toHaveBeenCalled();
  });

  it("still inserts normally when nothing is adopted", async () => {
    const h = harness();
    await waitFor(() => expect(h.saveTrip).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.result.current.savedTripId).toBe("inserted-1"));
  });
});

describe("useAutoSaveTrip: deferring for a pending claim", () => {
  it("skips with reason pending_claim while deferred, and inserts once released", async () => {
    const h = harness({ deferred: true });
    await waitFor(() => expect(h.onSkipped).toHaveBeenCalledWith("pending_claim"));
    expect(h.saveTrip).not.toHaveBeenCalled();

    h.rerender({ ...h.base, deferred: false });
    await waitFor(() => expect(h.saveTrip).toHaveBeenCalledTimes(1));
  });

  it("does not insert when the deferral resolves into an adoption", async () => {
    const h = harness({ deferred: true });
    await waitFor(() => expect(h.onSkipped).toHaveBeenCalledWith("pending_claim"));
    h.rerender({ ...h.base, deferred: false, adoptedTripId: "claimed-9" });
    await waitFor(() => expect(h.result.current.savedTripId).toBe("claimed-9"));
    // Give a would-be insert every chance to fire before asserting it did not.
    await new Promise((r) => setTimeout(r, 30));
    expect(h.saveTrip).not.toHaveBeenCalled();
  });
});
