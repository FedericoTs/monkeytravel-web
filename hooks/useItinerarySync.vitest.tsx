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
type TripProps = { id: string; itinerary: ItineraryDay[]; itineraryVersion: number; startDate: string; endDate: string };

function render({
  ambientEdit = true,
  id,
  version = 1,
  stored = plan("a"),
  initial = stored,
}: { ambientEdit?: boolean; id?: string; version?: number; stored?: ItineraryDay[]; initial?: ItineraryDay[] } = {}) {
  // A trip id of its own: the queue remembers the versions it saw per trip.
  const trip: TripProps = { id: id ?? `trip-${++tripCount}`, itinerary: stored, itineraryVersion: version, startDate: "2027-05-10", endDate: "2027-05-12" };
  const clearHistory = vi.fn();
  const hook = renderHook(({ trip }: { trip: TripProps }) => {
    const [editedItinerary, setEditedItinerary] = useState(() => initial);
    const [isEditMode, setIsEditMode] = useState(false);
    const [, setRenderEpoch] = useState(0);
    const [, setAiUpdatedActivityId] = useState<string | null>(null);
    const lastFailedSaveRef = useRef<string | null>(null);
    const stableClear = useCallback(() => clearHistory(), []);
    const sync = useItinerarySync({
      trip,
      initialItinerary: initial,
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
  }, { initialProps: { trip } });
  return { ...hook, clearHistory, trip };
}

/** What the trip's own read answers. */
const storedTrip = (version: number, itinerary: ItineraryDay[], dates = { start_date: "2027-05-10", end_date: "2027-05-12" }) =>
  new Response(JSON.stringify({ trip: { id: "t", itinerary, itinerary_version: version, ...dates } }), { status: 200 });
const reads = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== "PATCH");

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

describe("useItinerarySync: new dates", () => {
  const moved = (...names: string[]) => [{ ...plan(...names)[0], date: "2027-06-01" }] as unknown as ItineraryDay[];

  it("writes the dates and the days moved onto them together, then shows the stored trip", async () => {
    const { result, clearHistory } = render();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.writeTripDates("2027-06-01", "2027-06-01", moved("a"));
    });
    expect(ok).toBe(true);
    expect(patches()).toEqual([{ itinerary: moved("a"), baseItineraryVersion: 1, start_date: "2027-06-01", end_date: "2027-06-01" }]);
    expect(result.current.editedItinerary).toEqual(moved("a"));
    expect(result.current.hasChanges).toBe(false);
    // An undo would bring back the days on their old dates; the hero's dates come from the server.
    expect(clearHistory).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();

    // The next edit builds on the version the dates were written at.
    await edit(result, "a", "b");
    expect(patches()[1].baseItineraryVersion).toBe(2);
  });

  it("changes nothing when the trip changed elsewhere in the meantime", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result } = render();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.writeTripDates("2027-06-01", "2027-06-01", moved("a"));
    });
    expect(ok).toBe(false);
    expect(names(result.current.editedItinerary)).toEqual(["a"]);
    expect(result.current.editedItinerary[0].date).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("useItinerarySync: a save and what it is built on", () => {
  it("is never cancelled: a PATCH the server already has would still land under the next one", async () => {
    const { result } = render();
    await edit(result, "a", "b");
    const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")!;
    expect((init as RequestInit).signal).toBeUndefined();
  });

  it("an edit waiting to save takes a day regenerated meanwhile with it, on the new version", async () => {
    const { result } = render();
    act(() => result.current.setEditedItinerary(plan("a", "b")));
    await act(() =>
      result.current.adoptDayWrite((days) => days.map((d) => ({ ...d, theme: "regenerated" })), 1, 2)
    );
    await act(() => vi.advanceTimersByTimeAsync(1000));
    const [patch] = patches();
    expect(patch.baseItineraryVersion).toBe(2);
    expect(names(patch.itinerary)).toEqual(["a", "b"]);
    expect(patch.itinerary[0].theme).toBe("regenerated");
  });

  it("a day regenerated while nothing is edited doesn't count as an edit, and the next save builds on it", async () => {
    const { result } = render();
    await act(() =>
      result.current.adoptDayWrite((days) => days.map((d) => ({ ...d, theme: "regenerated" })), 1, 2)
    );
    expect(result.current.hasChanges).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(patches()).toEqual([]);

    await edit(result, "a", "b");
    expect(patches()[0].baseItineraryVersion).toBe(2);
  });

  it("a day regenerated from a version this page doesn't hold makes it read the stored copy", async () => {
    fetchMock.mockImplementation(async () => storedTrip(7, plan("from the server")));
    const { result } = render();
    await act(() => result.current.adoptDayWrite((days) => days, 5, 6));
    expect(reads()).toHaveLength(1);
    expect(names(result.current.editedItinerary)).toEqual(["from the server"]);
    await edit(result, "z");
    expect(patches()[0].baseItineraryVersion).toBe(7);
  });

  it("a save already queued when a regenerated day lands carries the day too", async () => {
    const { result } = render();
    let finish!: () => void;
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.runItineraryWrite(() => new Promise<void>((resolve) => (finish = resolve)), { keepsLocalEdits: true });
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    // Edited during the regeneration; the auto-save waits behind it.
    await edit(result, "a", "mine");
    expect(patches()).toEqual([]);

    await act(async () => {
      await result.current.adoptDayWrite((days) => days.map((d) => ({ ...d, theme: "regenerated" })), 1, 2);
      finish();
      await write;
      await vi.advanceTimersByTimeAsync(0);
    });
    const [patch] = patches();
    expect(patch.baseItineraryVersion).toBe(2);
    expect(names(patch.itinerary)).toEqual(["a", "mine"]);
    expect(patch.itinerary[0].theme).toBe("regenerated");
  });

  it("isn't sent on a version its content doesn't contain: a server copy taken while it waited", async () => {
    const { result } = render();
    let finish!: () => void;
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.runItineraryWrite(() => new Promise<void>((resolve) => (finish = resolve)));
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    // Edited while the write holds the queue; the auto-save waits behind it.
    await edit(result, "a", "stale");
    expect(patches()).toEqual([]);

    await act(async () => {
      result.current.adoptStoredItinerary(plan("server"), 7);
      finish();
      await write;
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patches()).toEqual([]);
    expect(names(result.current.editedItinerary)).toEqual(["server"]);
    expect(result.current.hasChanges).toBe(false);
  });

  it("the explicit Save waits for a server write this tab started", async () => {
    const { result } = render({ ambientEdit: false });
    act(() => result.current.handleEnterEditMode());
    await edit(result, "a", "b");
    let finish!: () => void;
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.runItineraryWrite(() => new Promise<void>((resolve) => (finish = resolve)), { keepsLocalEdits: true });
    });
    expect(result.current.itineraryWritesInFlight).toBe(1);

    await act(() => result.current.handleSaveChanges());
    expect(patches()).toEqual([]);
    expect(result.current.isEditMode).toBe(true);

    await act(async () => {
      finish();
      await write;
    });
    expect(result.current.itineraryWritesInFlight).toBe(0);
    await act(() => result.current.handleSaveChanges());
    expect(patches()).toHaveLength(1);
  });
});

describe("useItinerarySync: a save held back", () => {
  it("a write refused over a conflict doesn't send the edit the conflict holds", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result } = render();
    await edit(result, "a", "b");
    act(() => result.current.setEditedItinerary(plan("a", "b", "c")));
    await act(async () => {
      await expect(result.current.runItineraryWrite(vi.fn())).rejects.toThrow("detail.writeBlockedConflict");
    });
    expect(patches()).toHaveLength(1);
  });

  it("leaving the page doesn't send again a save that just failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const { result, unmount } = render();
    await edit(result, "a", "b");
    expect(result.current.saveStatus).toBe("error");
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(patches()).toHaveLength(1);
  });

  it("leaving the page sends an edit still waiting for its second", async () => {
    const { result, unmount } = render();
    act(() => result.current.setEditedItinerary(plan("a", "b")));
    expect(patches()).toEqual([]);
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(patches()).toHaveLength(1);
  });
});

describe("useItinerarySync: a server write over unsaved edits", () => {
  const editing = async () => {
    const view = render({ ambientEdit: false });
    act(() => view.result.current.handleEnterEditMode());
    await edit(view.result, "a", "b");
    return view;
  };

  it("is refused while an editor has edits they haven't saved", async () => {
    const { result } = await editing();
    const task = vi.fn();
    await act(async () => {
      await expect(result.current.runItineraryWrite(task)).rejects.toThrow("detail.writeBlockedUnsaved");
    });
    expect(task).not.toHaveBeenCalled();
  });

  it("runs when its result is merged into the page's copy", async () => {
    const { result } = await editing();
    const task = vi.fn(async () => "done");
    await act(async () => {
      await expect(result.current.runItineraryWrite(task, { keepsLocalEdits: true })).resolves.toBe("done");
    });
  });

  it("runs for someone outside edit mode: there is nothing they could save", async () => {
    const { result } = render({ ambientEdit: false });
    const task = vi.fn(async () => "done");
    await act(async () => {
      await expect(result.current.runItineraryWrite(task)).resolves.toBe("done");
    });
  });

  it("gives a save that failed one more try first", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const { result } = render();
    await edit(result, "a", "b");
    expect(result.current.saveStatus).toBe("error");
    const task = vi.fn(async () => "done");
    await act(async () => {
      await expect(result.current.runItineraryWrite(task)).resolves.toBe("done");
    });
    expect(patches()).toHaveLength(2);
  });

  it("is refused when that try fails too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));
    const { result } = render();
    await edit(result, "a", "b");
    const task = vi.fn();
    await act(async () => {
      await expect(result.current.runItineraryWrite(task)).rejects.toThrow("detail.writeBlockedUnsaved");
    });
    expect(task).not.toHaveBeenCalled();
  });
});

describe("useItinerarySync: taking the stored copy", () => {
  it("a refetch takes it with its version, and drops undo history", async () => {
    fetchMock.mockImplementation(async () => storedTrip(5, plan("x")));
    const { result, clearHistory } = render();
    await act(async () => {
      await expect(result.current.handleRefetchTrip()).resolves.toBe(true);
    });
    expect(names(result.current.editedItinerary)).toEqual(["x"]);
    expect(result.current.hasChanges).toBe(false);
    expect(clearHistory).toHaveBeenCalled();

    fetchMock.mockImplementation(async () => saved(6));
    await edit(result, "x", "y");
    expect(patches()[0].baseItineraryVersion).toBe(5);
  });

  it("a refetch after a write stays out of the way of an edit made while it read", async () => {
    fetchMock.mockImplementation(async () => storedTrip(5, plan("x")));
    const { result, clearHistory } = render();
    act(() => result.current.setEditedItinerary(plan("a", "mine")));
    await act(async () => {
      await expect(result.current.handleRefetchTrip({ onlyIfUnedited: true })).resolves.toBe(false);
    });
    expect(names(result.current.editedItinerary)).toEqual(["a", "mine"]);
    expect(clearHistory).not.toHaveBeenCalled();
  });

  it("a queued refetch doesn't read while a conflict holds the page's edits", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result } = render();
    await edit(result, "a", "b");
    const before = reads().length;
    await act(() => result.current.refetchQueued());
    expect(reads()).toHaveLength(before);
    expect(names(result.current.editedItinerary)).toEqual(["a", "b"]);
  });

  it("a refetch clears a conflict it resolves", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result } = render();
    await edit(result, "a", "b");
    fetchMock.mockImplementation(async () => storedTrip(6, plan("y")));
    await act(() => result.current.handleRefetchTrip());
    expect(result.current.conflict).toBeNull();
    expect(names(result.current.editedItinerary)).toEqual(["y"]);
  });

  it("a refetch asks the page to re-read when the dates moved", async () => {
    fetchMock.mockImplementation(async () => storedTrip(5, plan("x"), { start_date: "2027-06-01", end_date: "2027-06-03" }));
    const { result } = render();
    await act(() => result.current.handleRefetchTrip());
    expect(refresh).toHaveBeenCalled();
  });

  it("a refetch reads once more when the first read fails", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockImplementation(async () => storedTrip(5, plan("x")));
    const { result } = render();
    await act(async () => {
      const refetched = result.current.handleRefetchTrip();
      await vi.advanceTimersByTimeAsync(800);
      await expect(refetched).resolves.toBe(true);
    });
    expect(reads()).toHaveLength(2);
  });

  it("taking a copy from a write drops undo history and sets the version", async () => {
    const { result, clearHistory } = render();
    act(() => result.current.adoptStoredItinerary(plan("x"), 9));
    expect(names(result.current.editedItinerary)).toEqual(["x"]);
    expect(clearHistory).toHaveBeenCalled();
    await edit(result, "x", "y");
    expect(patches()[0].baseItineraryVersion).toBe(9);
  });
});

describe("useItinerarySync: newer props", () => {
  const newer = (trip: TripProps) => ({ trip: { ...trip, itinerary: plan("from a refresh"), itineraryVersion: 3 } });

  it("are taken as a pair, content and version together, when nothing is edited", async () => {
    const { result, rerender, trip, clearHistory } = render();
    rerender(newer(trip));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(names(result.current.editedItinerary)).toEqual(["from a refresh"]);
    expect(clearHistory).toHaveBeenCalled();
    await edit(result, "from a refresh", "mine");
    expect(patches()[0].baseItineraryVersion).toBe(3);
  });

  it("never replace edits: the save still builds on the version they were made on", async () => {
    const { result, rerender, trip, clearHistory } = render();
    act(() => result.current.setEditedItinerary(plan("a", "mine")));
    rerender(newer(trip));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(names(result.current.editedItinerary)).toEqual(["a", "mine"]);
    expect(clearHistory).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(patches()[0].baseItineraryVersion).toBe(1);
  });

  it("don't override a conflict the person still has to choose on", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result, rerender, trip } = render();
    await edit(result, "a", "b");
    rerender({ trip: { ...trip, itinerary: plan("newer"), itineraryVersion: 9 } });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(names(result.current.editedItinerary)).toEqual(["a", "b"]);
    expect(result.current.conflict?.server.version).toBe(5);
  });

  it("wait for that choice even when the edit has been undone by hand", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result, rerender, trip } = render();
    await edit(result, "a", "b");
    act(() => result.current.setEditedItinerary(plan("a")));
    rerender({ trip: { ...trip, itinerary: plan("newer"), itineraryVersion: 9 } });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(names(result.current.editedItinerary)).toEqual(["a"]);
    expect(result.current.conflict?.server.version).toBe(5);
  });

  it("older ones change nothing", async () => {
    const { result, rerender, trip } = render({ version: 4 });
    rerender({ trip: { ...trip, itinerary: plan("older"), itineraryVersion: 2 } });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(names(result.current.editedItinerary)).toEqual(["a"]);
  });
});

describe("useItinerarySync: a page restored from the router cache", () => {
  it("asks for a fresh copy when this tab has already seen a newer version", async () => {
    const id = `trip-restored-${++tripCount}`;
    const first = render({ id });
    await edit(first.result, "a", "b");
    first.unmount();
    refresh.mockClear();

    render({ id, version: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("doesn't when it is on the newest one", async () => {
    render();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("useItinerarySync: activities stored without an id", () => {
  const stored = [{ day_number: 1, activities: [{ name: "a" }] }] as unknown as ItineraryDay[];

  it("a solo owner's page stores the ids it derived, once", async () => {
    const { result } = render({ stored, initial: plan("a") });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(patches()).toEqual([{ itinerary: plan("a"), baseItineraryVersion: 1 }]);
    expect(result.current.hasChanges).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(patches()).toHaveLength(1);
  });

  it("if the trip changed meanwhile and nothing is edited, it takes the stored copy", async () => {
    fetchMock.mockResolvedValueOnce(conflictReply(5, plan("x")));
    const { result, clearHistory } = render({ stored, initial: plan("a") });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(names(result.current.editedItinerary)).toEqual(["x"]);
    expect(result.current.conflict).toBeNull();
    expect(clearHistory).toHaveBeenCalled();
  });

  it("an editor's page stores nothing on load", async () => {
    render({ ambientEdit: false, stored, initial: plan("a") });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(patches()).toEqual([]);
  });

  it("nothing to store when every activity has an id", async () => {
    render();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(patches()).toEqual([]);
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
