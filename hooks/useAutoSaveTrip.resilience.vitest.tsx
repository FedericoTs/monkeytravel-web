import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoSaveTrip, type AutoSaveSkipReason } from "./useAutoSaveTrip";
import type { GeneratedItinerary } from "@/types";
import type { TripFormState } from "@/lib/trips/persistTrip";

/**
 * Resilience + observability of the auto-save (2026-09-02).
 *
 * Six signed-in users in 30 days reached a rendered itinerary and no save was
 * ever ATTEMPTED — the edge logs show their browsers authenticated before and
 * after, and not one getUser or insert_trip_dedup call in between. Every
 * early return in the hook was silent and every failure ended in a
 * console.error nobody could read. These tests pin the two properties that
 * make that impossible to miss again: a skip is reported with its reason,
 * and a failure is retried before it is reported with its attempt count.
 */

function makeItinerary(seed = 1): GeneratedItinerary {
  return {
    destination: { name: `City-${seed}`, country: "Country", description: "", best_for: [], weather_note: "" },
    days: [],
    trip_summary: { total_estimated_cost: 100, currency: "USD", highlights: [], packing_suggestions: [] },
    booking_links: {},
  } as unknown as GeneratedItinerary;
}

const FORM: TripFormState = {
  destination: "Paris",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: [],
  derivedInterests: ["culture"],
};

function harness(opts: {
  itinerary?: GeneratedItinerary | null;
  isAuthenticated?: boolean | null;
  enabled?: boolean;
  saveTrip?: ReturnType<typeof vi.fn>;
}) {
  const saveTrip = opts.saveTrip ?? vi.fn(async () => ({ tripId: "trip-1", durationDays: 5 }));
  const onPersisted = vi.fn();
  const onError = vi.fn();
  const onSkipped = vi.fn<(reason: AutoSaveSkipReason) => void>();
  const hook = renderHook(
    (p: { itinerary: GeneratedItinerary | null; isAuthenticated: boolean | null; enabled: boolean }) =>
      useAutoSaveTrip({
        itinerary: p.itinerary,
        isAuthenticated: p.isAuthenticated,
        enabled: p.enabled,
        formState: FORM,
        saveTrip,
        updateTrip: vi.fn(async () => undefined),
        deleteTrip: vi.fn(async () => undefined),
        onPersisted,
        onError,
        onSkipped,
        retryDelaysMs: [0, 0],
      }),
    {
      // Explicit undefined checks: `??` would replace a deliberate null
      // itinerary or a deliberate null/false auth state with the default.
      initialProps: {
        itinerary: opts.itinerary === undefined ? makeItinerary() : opts.itinerary,
        isAuthenticated: opts.isAuthenticated === undefined ? true : opts.isAuthenticated,
        enabled: opts.enabled === undefined ? true : opts.enabled,
      },
    }
  );
  return { ...hook, saveTrip, onPersisted, onError, onSkipped };
}

describe("a failed save is retried before it is reported", () => {
  it("succeeds on the second attempt and reports nothing", async () => {
    const saveTrip = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ tripId: "trip-1", durationDays: 5 });
    const h = harness({ saveTrip });
    await waitFor(() => expect(h.onPersisted).toHaveBeenCalledWith("trip-1", 5, "insert"));
    expect(saveTrip).toHaveBeenCalledTimes(2);
    expect(h.onError).not.toHaveBeenCalled();
    await waitFor(() => expect(h.result.current.status).toBe("saved"));
    expect(h.result.current.savedTripId).toBe("trip-1");
  });

  it("gives up after every attempt and reports once, with the attempt count", async () => {
    const saveTrip = vi.fn().mockRejectedValue(new Error("insert_trip_dedup requires an authenticated caller"));
    const h = harness({ saveTrip });
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1));
    expect(saveTrip).toHaveBeenCalledTimes(3);
    const [err, info] = h.onError.mock.calls[0] as [Error, { attempts: number }];
    expect(err.message).toMatch(/authenticated caller/);
    expect(info).toEqual({ attempts: 3 });
    // setStatus is dispatched just before onError; under load the commit can
    // land after the callback, so poll rather than read result.current once.
    await waitFor(() => expect(h.result.current.status).toBe("error"));
    expect(h.onPersisted).not.toHaveBeenCalled();
  });
});

describe("a skipped save is reported with its reason, once per itinerary", () => {
  it("anonymous visitor → not_authenticated, and no save attempt", async () => {
    const h = harness({ isAuthenticated: false });
    await waitFor(() => expect(h.onSkipped).toHaveBeenCalledWith("not_authenticated"));
    expect(h.saveTrip).not.toHaveBeenCalled();
    h.rerender({ itinerary: h.result.current.savedTripId ? null : makeItinerary(), isAuthenticated: false, enabled: true });
    // A new identity for the same reason reports again; the same identity does not.
    expect(h.onSkipped).toHaveBeenCalledTimes(2);
  });

  it("auth still loading → auth_pending, then the save runs once auth resolves", async () => {
    const it1 = makeItinerary();
    const h = harness({ itinerary: it1, isAuthenticated: null });
    await waitFor(() => expect(h.onSkipped).toHaveBeenCalledWith("auth_pending"));
    expect(h.saveTrip).not.toHaveBeenCalled();
    h.rerender({ itinerary: it1, isAuthenticated: true, enabled: true });
    await waitFor(() => expect(h.onPersisted).toHaveBeenCalledTimes(1));
    expect(h.onSkipped).toHaveBeenCalledTimes(1);
  });

  it("env kill switch → disabled", async () => {
    const h = harness({ enabled: false });
    await waitFor(() => expect(h.onSkipped).toHaveBeenCalledWith("disabled"));
    expect(h.saveTrip).not.toHaveBeenCalled();
  });

  it("never reports a skip when there is no itinerary yet", async () => {
    const h = harness({ itinerary: null, isAuthenticated: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.onSkipped).not.toHaveBeenCalled();
  });
});
