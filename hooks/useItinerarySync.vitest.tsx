import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { useItinerarySync } from "./useItinerarySync";
import { ItineraryWriteBlockedError } from "@/lib/trips/itinerary-sync";
import type { ItineraryDay } from "@/types";

const addToast = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/posthog/events", () => ({
  captureEditModeSaved: vi.fn(),
  captureEditModeDiscarded: vi.fn(),
  captureEditModeEntered: vi.fn(),
}));

const plan = (...names: string[]) =>
  [{ day_number: 1, activities: names.map((name) => ({ id: `id-${name}`, name })) }] as unknown as ItineraryDay[];
const names = (days: ItineraryDay[]) => days[0].activities.map((a) => a.name);

let fetchMock: ReturnType<typeof vi.fn>;
const saved = (version: number) => new Response(JSON.stringify({ trip: { itinerary_version: version } }), { status: 200 });
const conflictReply = (version: number, itinerary: ItineraryDay[]) =>
  new Response(JSON.stringify({ code: "ITINERARY_CONFLICT", itineraryVersion: version, itinerary }), { status: 409 });
const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { itinerary: ItineraryDay[]; baseItineraryVersion?: number });

let tripCount = 0;
function render({ ambientEdit = true } = {}) {
  // A trip id of its own: the queue remembers the versions it saw per trip.
  const trip = { id: `trip-${++tripCount}`, itinerary: plan("a"), itineraryVersion: 1, startDate: "2027-05-10", endDate: "2027-05-12" };
  const clearHistory = vi.fn();
  const hook = renderHook(() => {
    const [editedItinerary, setEditedItinerary] = useState(() => plan("a"));
    const [isEditMode, setIsEditMode] = useState(false);
    const [, setRenderEpoch] = useState(0);
    const [, setAiUpdatedActivityId] = useState<string | null>(null);
    const lastFailedSaveRef = useRef<string | null>(null);
    const stableClear = useCallback(() => clearHistory(), []);
    const sync = useItinerarySync({
      trip,
      initialItinerary: trip.itinerary,
      editedItinerary,
      setEditedItinerary,
      isEditMode,
      setIsEditMode,
      ambientEdit,
      lastFailedSaveRef,
      clearHistory: stableClear,
      setRenderEpoch,
      setAiUpdatedActivityId,
    });
    return { ...sync, editedItinerary, setEditedItinerary, isEditMode, setIsEditMode };
  });
  return { ...hook, clearHistory };
}

/** An edit as the page makes one, then the 1s auto-save wait. */
async function edit(result: { current: ReturnType<typeof render>["result"]["current"] }, ...next: string[]) {
  act(() => result.current.setEditedItinerary(plan(...next)));
  await act(() => vi.advanceTimersByTimeAsync(1000));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => saved(2));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useItinerarySync: a solo owner's auto-save", () => {
  it("saves an edit after a second, on top of the version the page holds", async () => {
    const { result } = render();
    act(() => result.current.setEditedItinerary(plan("a", "b")));
    expect(result.current.saveStatus).toBe("saving");
    expect(patches()).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(patches()).toEqual([{ itinerary: plan("a", "b"), baseItineraryVersion: 1 }]);
    expect(result.current).toMatchObject({ saveStatus: "saved", hasChanges: false });

    await edit(result, "a", "b", "c");
    expect(patches()[1].baseItineraryVersion).toBe(2);
  });

  it("turns a save refused because the trip changed elsewhere into a conflict, and holds later saves", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result } = render();
    await edit(result, "a", "b");
    expect(result.current.saveStatus).toBe("conflict");
    expect(result.current.conflict?.server.version).toBe(5);

    await edit(result, "a", "b", "c");
    expect(patches()).toHaveLength(1);
  });

  it("Load latest takes the stored copy and drops the edit", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result, clearHistory } = render();
    await edit(result, "a", "b");

    act(() => result.current.handleLoadLatest());
    expect(names(result.current.editedItinerary)).toEqual(["x"]);
    expect(result.current).toMatchObject({ conflict: null, saveStatus: "saved", hasChanges: false });
    expect(clearHistory).toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("detail.conflictLoadedLatest", "success");
  });

  it("Keep mine saves the edit on top of the newer version", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x"))).mockResolvedValueOnce(saved(6));
    const { result } = render();
    await edit(result, "a", "b");

    await act(async () => {
      result.current.handleKeepMine();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patches()[1]).toEqual({ itinerary: plan("a", "b"), baseItineraryVersion: 5 });
    expect(result.current).toMatchObject({ conflict: null, saveStatus: "saved", hasChanges: false });
  });

  it("does not retry a save that failed until the plan changes again", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = render();
    await edit(result, "a", "b");
    expect(result.current.saveStatus).toBe("error");

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(patches()).toHaveLength(1);

    await edit(result, "a", "b", "c");
    expect(patches()).toHaveLength(2);
    expect(result.current.saveStatus).toBe("saved");
  });
});

describe("useItinerarySync: server writes", () => {
  it("sends the pending edit before a server write runs", async () => {
    const { result } = render();
    act(() => result.current.setEditedItinerary(plan("a", "b")));
    const order: string[] = [];
    fetchMock.mockImplementation(async () => {
      order.push("save");
      return saved(2);
    });
    await act(() =>
      result.current.runItineraryWrite(async () => {
        order.push("write");
      })
    );
    expect(order).toEqual(["save", "write"]);
  });

  it("refuses a server write while a conflict holds the page's edits", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result } = render();
    await edit(result, "a", "b");
    const task = vi.fn();
    await act(async () => {
      const refused = result.current.runItineraryWrite(task);
      await expect(refused).rejects.toBeInstanceOf(ItineraryWriteBlockedError);
      await expect(refused).rejects.toThrow("detail.writeBlockedConflict");
    });
    expect(task).not.toHaveBeenCalled();
  });
});

describe("useItinerarySync: edit mode and the explicit Save", () => {
  it("does not auto-save, and Save sends the edit and leaves edit mode", async () => {
    const { result } = render({ ambientEdit: false });
    act(() => result.current.handleEnterEditMode());
    expect(result.current.isEditMode).toBe(true);

    await edit(result, "a", "b");
    expect(patches()).toEqual([]);

    await act(() => result.current.handleSaveChanges());
    expect(patches()).toEqual([{ itinerary: plan("a", "b"), baseItineraryVersion: 1 }]);
    expect(result.current).toMatchObject({ isEditMode: false, saveSuccess: true, hasChanges: false });
  });

  it("Discard goes back to the saved copy", async () => {
    const { result } = render({ ambientEdit: false });
    act(() => result.current.handleEnterEditMode());
    await edit(result, "a", "b");
    act(() => result.current.handleDiscardChanges());
    expect(names(result.current.editedItinerary)).toEqual(["a"]);
    expect(result.current.isEditMode).toBe(false);
  });
});
