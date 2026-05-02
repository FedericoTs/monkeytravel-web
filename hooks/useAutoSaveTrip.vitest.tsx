/**
 * Tests for useAutoSaveTrip — the state machine behind auto-saving a
 * generated trip. Covers the four risk paths that motivated the hook:
 *
 *   1. dedup (INSERT once, not N times)
 *   2. UPDATE-on-regenerate (no duplicate trip rows)
 *   3. regenerate awaits in-flight save (no silent data loss)
 *   4. error path surfaces + retries
 *
 * Plus the simpler guards (auth, flag, discard) and the cover-image
 * attach happening fire-and-forget after INSERT.
 *
 * The hook is wired with mock saveTrip/updateTrip/deleteTrip callbacks
 * — no Supabase, no network. Each test runs in <50ms.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAutoSaveTrip } from "./useAutoSaveTrip";
import type { GeneratedItinerary } from "@/types";
import type { TripFormState } from "@/lib/trips/persistTrip";

// --- Fixtures ---

function makeItinerary(seed = 1): GeneratedItinerary {
  return {
    destination: {
      name: `City-${seed}`,
      country: "Country",
      description: "desc",
      best_for: ["foo"],
      weather_note: "",
    },
    days: [],
    trip_summary: {
      total_estimated_cost: 100,
      currency: "USD",
      highlights: [],
      packing_suggestions: [],
    },
    booking_links: {},
    // The hook is structurally typed against this shape; extra runtime
    // fields the production type carries don't matter for these tests.
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

interface MockHandles {
  saveTrip: ReturnType<typeof vi.fn>;
  updateTrip: ReturnType<typeof vi.fn>;
  deleteTrip: ReturnType<typeof vi.fn>;
  attachCoverImage: ReturnType<typeof vi.fn>;
  onPersisted: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
}

function makeMocks(): MockHandles {
  return {
    saveTrip: vi.fn(async () => ({ tripId: "trip-1", durationDays: 5 })),
    updateTrip: vi.fn(async () => undefined),
    deleteTrip: vi.fn(async () => undefined),
    attachCoverImage: vi.fn(async () => undefined),
    onPersisted: vi.fn(),
    onError: vi.fn(),
  };
}

interface RenderOpts {
  itinerary?: GeneratedItinerary | null;
  isAuthenticated?: boolean | null;
  enabled?: boolean;
  formState?: TripFormState;
  mocks?: MockHandles;
}

function renderAutoSaveHook(initial: RenderOpts = {}) {
  const mocks = initial.mocks ?? makeMocks();
  const hook = renderHook(
    (props: RenderOpts) =>
      useAutoSaveTrip({
        itinerary: props.itinerary ?? null,
        isAuthenticated: props.isAuthenticated ?? true,
        enabled: props.enabled ?? true,
        formState: props.formState ?? FORM,
        saveTrip: mocks.saveTrip,
        updateTrip: mocks.updateTrip,
        deleteTrip: mocks.deleteTrip,
        attachCoverImage: mocks.attachCoverImage,
        onPersisted: mocks.onPersisted,
        onError: mocks.onError,
      }),
    { initialProps: initial },
  );
  return { result: hook.result, rerender: hook.rerender, mocks };
}

// --- Tests ---

describe("useAutoSaveTrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("INSERTs once when itinerary becomes available, then attaches the cover image", async () => {
    const itinerary = makeItinerary();
    const { result, rerender, mocks } = renderAutoSaveHook({ itinerary: null });
    expect(result.current.status).toBe("idle");

    rerender({ itinerary });
    await waitFor(() => expect(result.current.status).toBe("saved"));

    expect(mocks.saveTrip).toHaveBeenCalledTimes(1);
    expect(mocks.updateTrip).not.toHaveBeenCalled();
    expect(result.current.savedTripId).toBe("trip-1");
    expect(mocks.attachCoverImage).toHaveBeenCalledWith("trip-1", "Paris");
    expect(mocks.onPersisted).toHaveBeenCalledWith("trip-1", 5, "insert");
  });

  it("does not save when not authenticated", async () => {
    const itinerary = makeItinerary();
    const { result, mocks } = renderAutoSaveHook({
      itinerary,
      isAuthenticated: false,
    });
    // Give effects a tick to fire (they shouldn't).
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.saveTrip).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("does not save when feature flag is disabled", async () => {
    const itinerary = makeItinerary();
    const { result, mocks } = renderAutoSaveHook({
      itinerary,
      enabled: false,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.saveTrip).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("UPDATEs on regenerate after the first save (preserves trip id)", async () => {
    const first = makeItinerary(1);
    const second = makeItinerary(2);
    const { result, rerender, mocks } = renderAutoSaveHook({ itinerary: first });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1);

    // User clicks Regenerate. Hook flushes any in-flight save and
    // resets its dedup guard.
    await act(async () => {
      await result.current.regenerate();
    });
    // Page would now setGeneratedItinerary(null) then call generate again.
    rerender({ itinerary: null });
    rerender({ itinerary: second });

    await waitFor(() =>
      expect(mocks.updateTrip).toHaveBeenCalledTimes(1),
    );
    // Insert was NOT called a second time.
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1);
    // Trip id unchanged.
    expect(result.current.savedTripId).toBe("trip-1");
    expect(mocks.onPersisted).toHaveBeenLastCalledWith("trip-1", 5, "update");
  });

  it("regenerate awaits the in-flight save before clearing the dedup guard", async () => {
    const first = makeItinerary(1);
    const second = makeItinerary(2);
    const mocks = makeMocks();

    // Make saveTrip controllable so we can drive the race deterministically.
    let resolveSave!: (v: { tripId: string; durationDays: number }) => void;
    mocks.saveTrip.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { result, rerender } = renderAutoSaveHook({ itinerary: first, mocks });

    // saveTrip is in flight; status is "saving".
    await waitFor(() => expect(result.current.status).toBe("saving"));

    // User clicks Regenerate while the first save hasn't resolved yet.
    let regenerateSettled = false;
    const regenPromise = act(async () => {
      await result.current.regenerate();
      regenerateSettled = true;
    });
    // regenerate must NOT resolve until the in-flight save resolves.
    await Promise.resolve();
    expect(regenerateSettled).toBe(false);

    // Now resolve the in-flight save.
    resolveSave({ tripId: "trip-1", durationDays: 5 });
    await regenPromise;
    expect(regenerateSettled).toBe(true);

    // savedTripId is set, so the next persist will be UPDATE.
    expect(result.current.savedTripId).toBe("trip-1");

    // Page clears + sets new itinerary; UPDATE fires (not INSERT).
    rerender({ itinerary: null });
    rerender({ itinerary: second });
    await waitFor(() =>
      expect(mocks.updateTrip).toHaveBeenCalledTimes(1),
    );
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1);
  });

  it("surfaces save errors and lets retry succeed", async () => {
    const itinerary = makeItinerary();
    const mocks = makeMocks();
    mocks.saveTrip
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ tripId: "trip-1", durationDays: 5 });

    const { result } = renderAutoSaveHook({ itinerary, mocks });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("boom");
    expect(mocks.onError).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2);
  });

  it("discard deletes the saved trip and resets to idle", async () => {
    const itinerary = makeItinerary();
    const { result, mocks } = renderAutoSaveHook({ itinerary });
    await waitFor(() => expect(result.current.status).toBe("saved"));

    await act(async () => {
      await result.current.discard();
    });

    expect(mocks.deleteTrip).toHaveBeenCalledWith("trip-1");
    expect(result.current.savedTripId).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("discard is a no-op delete when nothing has been saved yet", async () => {
    const { result, mocks } = renderAutoSaveHook({ itinerary: null });
    await act(async () => {
      await result.current.discard();
    });
    expect(mocks.deleteTrip).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});
