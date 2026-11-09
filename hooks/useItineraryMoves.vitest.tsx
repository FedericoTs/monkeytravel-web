import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { useItineraryMoves } from "./useItineraryMoves";
import { captureActivityModified } from "@/lib/posthog/events";
import type { ItineraryDay } from "@/types";

const addToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/posthog/events", () => ({ captureActivityModified: vi.fn() }));
vi.mock("@/lib/native/haptics", () => ({ hapticSelection: vi.fn() }));
const captured = vi.mocked(captureActivityModified);

const activity = (id: string, start_time: string) => ({
  id,
  name: `Activity ${id}`,
  type: "attraction",
  start_time,
  duration_minutes: 60,
  description: "",
  location: "",
  estimated_cost: { amount: 0, currency: "EUR", tier: "free" },
  tips: [],
});
const PLAN = [
  { day_number: 1, date: "2027-05-10", theme: "One", activities: [activity("a1", "09:00"), activity("a2", "14:00")] },
  { day_number: 2, date: "2027-05-11", theme: "Two", activities: [activity("b1", "10:00")] },
] as unknown as ItineraryDay[];

const ids = (days: ItineraryDay[]) => days.map((d) => d.activities.map((a) => a.id));

const pushUndo = vi.fn();
const focusDay = vi.fn();
let frames: FrameRequestCallback[] = [];

function useHarness(undo: () => void) {
  const [itinerary, setItinerary] = useState(PLAN);
  const moves = useItineraryMoves({ tripId: "trip-1", itinerary, setItinerary, pushUndo, undo, focusDay });
  return { itinerary, setItinerary, moves };
}
const render = (undo: () => void = vi.fn()) =>
  renderHook(({ undo }) => useHarness(undo), { initialProps: { undo } });

const start = (id: string) => ({ active: { id } }) as unknown as DragStartEvent;
const over = (id: string, overId: string) =>
  ({ active: { id, rect: { current: { translated: { top: 0 } } } }, over: { id: overId, rect: { top: 0, height: 100 } } }) as unknown as DragOverEvent;
const end = (id: string, overId: string | null) =>
  ({ active: { id }, over: overId ? { id: overId } : null }) as unknown as DragEndEvent;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useItineraryMoves: the card's Move to another day sheet", () => {
  // A card that didn't re-render calls the moveToDay it was given earlier: the
  // move must start from the plan as it is, or what came since is lost.
  it("moves within the plan as it is now, from a handler kept since an earlier render", () => {
    const { result } = render();
    const moveFromEarlier = result.current.moves.moveToDay;
    const withCheckIn = PLAN.map((d, i) => (i === 0 ? { ...d, activities: [...d.activities, activity("a3", "21:00")] } : d));
    act(() => result.current.setItinerary(withCheckIn as unknown as ItineraryDay[]));

    act(() => moveFromEarlier("a1", 1));
    expect(ids(result.current.itinerary)).toEqual([["a2", "a3"], ["a1", "b1"]]);
  });

  it("lands the activity in the chosen day's time order, with one undo entry, the day in view and an Undo toast", () => {
    const { result } = render();
    act(() => result.current.moves.moveToDay("b1", 0));

    expect(ids(result.current.itinerary)).toEqual([["a1", "b1", "a2"], []]);
    expect(pushUndo.mock.calls).toEqual([["Move activity to day 1"]]);
    expect(focusDay).toHaveBeenCalledWith(1);
    expect(addToast).toHaveBeenCalledWith('editActivity.movedToDay {"day":1}', "success", 6000, {
      label: "detail.undo",
      onClick: expect.any(Function),
    });
    expect(captured).toHaveBeenCalledWith({
      trip_id: "trip-1",
      activity_id: "b1",
      modification_type: "move_day",
      is_first_modification: true,
      day_number: 1,
      from_day_number: 2,
      method: "menu",
    });
  });

  it("keeps the times the traveller had: the moved stop's own, and every one on both days", () => {
    const { result } = render();
    act(() => result.current.moves.moveToDay("a2", 1));

    const times = result.current.itinerary.map((d) => d.activities.map((a) => `${a.start_time} ${a.id}`));
    expect(times).toEqual([["09:00 a1"], ["10:00 b1", "14:00 a2"]]);
  });

  it("counts only the first move as the first modification", () => {
    const { result } = render();
    act(() => result.current.moves.moveToDay("b1", 0));
    act(() => result.current.moves.moveToDay("a1", 1));
    expect(captured.mock.calls.map(([e]) => e.is_first_modification)).toEqual([true, false]);
  });

  it("leaves the plan alone for the activity's own day or an activity it doesn't have", () => {
    const { result } = render();
    act(() => result.current.moves.moveToDay("a1", 0));
    act(() => result.current.moves.moveToDay("nope", 1));
    expect(ids(result.current.itinerary)).toEqual(ids(PLAN));
    expect(pushUndo).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("undoes with the undo current when the toast is clicked, not the one at the move", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = render(first);
    act(() => result.current.moves.moveToDay("b1", 0));
    rerender({ undo: latest });
    addToast.mock.calls[0][3].onClick();
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});

describe("useItineraryMoves: dragging", () => {
  it("previews a card dragged over another day and commits it there on drop", () => {
    const { result } = render();
    act(() => result.current.moves.onDragStart(start("b1")));
    expect(result.current.moves.dragging).toBe(true);
    expect(result.current.moves.draggedActivity?.id).toBe("b1");
    expect(ids(result.current.moves.preview!)).toEqual(ids(PLAN));

    act(() => result.current.moves.onDragOver(over("b1", "day-drop:1")));
    expect(ids(result.current.moves.preview!)).toEqual([["a1", "a2", "b1"], []]);
    expect(ids(result.current.itinerary)).toEqual(ids(PLAN));
    expect(pushUndo).not.toHaveBeenCalled();

    act(() => result.current.moves.onDragEnd(end("b1", "day-drop:1")));
    expect(ids(result.current.itinerary)).toEqual([["a1", "a2", "b1"], []]);
    expect(result.current.moves.preview).toBeNull();
    expect(result.current.moves.dragging).toBe(false);
    expect(pushUndo.mock.calls).toEqual([["Move activity to day 1"]]);
    expect(focusDay).toHaveBeenCalledWith(1);
    expect(captured.mock.calls[0][0]).toMatchObject({ method: "drag", day_number: 1, from_day_number: 2 });
  });

  it("holds the preview for a frame after a cross-day step", () => {
    const { result } = render();
    act(() => result.current.moves.onDragStart(start("b1")));
    act(() => result.current.moves.onDragOver(over("b1", "day-drop:1")));
    act(() => result.current.moves.onDragOver(over("b1", "day-drop:2")));
    expect(ids(result.current.moves.preview!)).toEqual([["a1", "a2", "b1"], []]);

    act(() => frames.forEach((cb) => cb(0)));
    act(() => result.current.moves.onDragOver(over("b1", "day-drop:2")));
    expect(ids(result.current.moves.preview!)).toEqual(ids(PLAN));
  });

  it("reorders within a day on drop, with an undo entry and no toast", () => {
    const { result } = render();
    act(() => result.current.moves.onDragStart(start("a2")));
    act(() => result.current.moves.onDragOver(over("a2", "a1")));
    act(() => result.current.moves.onDragEnd(end("a2", "a1")));
    expect(ids(result.current.itinerary)).toEqual([["a2", "a1"], ["b1"]]);
    expect(pushUndo.mock.calls).toEqual([["Reorder activities"]]);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("changes nothing for a card dropped where it started, or a cancelled drag", () => {
    const { result } = render();
    act(() => result.current.moves.onDragStart(start("a1")));
    act(() => result.current.moves.onDragEnd(end("a1", "a1")));
    act(() => result.current.moves.onDragStart(start("b1")));
    act(() => result.current.moves.onDragOver(over("b1", "day-drop:1")));
    act(() => result.current.moves.onDragCancel());
    expect(ids(result.current.itinerary)).toEqual(ids(PLAN));
    expect(result.current.moves.preview).toBeNull();
    expect(result.current.moves.dragging).toBe(false);
    expect(pushUndo).not.toHaveBeenCalled();
  });
});
