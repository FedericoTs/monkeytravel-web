import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useItineraryHistory } from "./useItineraryHistory";
import type { ItineraryDay } from "@/types";

const plan = (...names: string[]) =>
  [{ day_number: 1, activities: names.map((name) => ({ id: name, name })) }] as unknown as ItineraryDay[];
const names = (days: ItineraryDay[]) => days[0].activities.map((a) => a.name);

function useHarness(onNavigate: () => void) {
  const [itinerary, setItinerary] = useState(plan("a"));
  const history = useItineraryHistory(itinerary, setItinerary, onNavigate);
  return { itinerary, setItinerary, history };
}
const render = (onNavigate = vi.fn()) => renderHook(() => useHarness(onNavigate));

/** A change as the page makes one: record it, then apply it. */
function change(result: { current: ReturnType<typeof useHarness> }, ...next: string[]) {
  act(() => result.current.history.push(`set ${next.join(",")}`));
  act(() => result.current.setItinerary(plan(...next)));
}

describe("useItineraryHistory", () => {
  it("undoes a change, and redoes it", () => {
    const { result } = render();
    expect(result.current.history).toMatchObject({ canUndo: false, canRedo: false });

    change(result, "a", "b");
    expect(result.current.history).toMatchObject({ canUndo: true, canRedo: false });

    act(() => result.current.history.undo());
    expect(names(result.current.itinerary)).toEqual(["a"]);
    expect(result.current.history).toMatchObject({ canUndo: false, canRedo: true });

    act(() => result.current.history.redo());
    expect(names(result.current.itinerary)).toEqual(["a", "b"]);
    expect(result.current.history).toMatchObject({ canUndo: true, canRedo: false });
  });

  it("steps back through several changes in order", () => {
    const { result } = render();
    change(result, "a", "b");
    change(result, "a", "b", "c");
    act(() => result.current.history.undo());
    expect(names(result.current.itinerary)).toEqual(["a", "b"]);
    act(() => result.current.history.undo());
    expect(names(result.current.itinerary)).toEqual(["a"]);
  });

  it("drops what could be redone once a new change is made", () => {
    const { result } = render();
    change(result, "a", "b");
    act(() => result.current.history.undo());
    change(result, "a", "z");
    expect(result.current.history.canRedo).toBe(false);
  });

  it("keeps the last 20 steps", () => {
    const { result } = render();
    for (let i = 1; i <= 25; i++) change(result, "a", String(i));
    for (let i = 0; i < 20; i++) act(() => result.current.history.undo());
    expect(result.current.history.canUndo).toBe(false);
    expect(names(result.current.itinerary)).toEqual(["a", "5"]);
  });

  it("keeps a copy, so a later change to the itinerary leaves the snapshot alone", () => {
    const { result } = render();
    act(() => result.current.history.push("edit in place"));
    act(() => {
      result.current.itinerary[0].activities[0].name = "changed";
    });
    act(() => result.current.history.undo());
    expect(names(result.current.itinerary)).toEqual(["a"]);
  });

  it("starts over on clear", () => {
    const { result } = render();
    change(result, "a", "b");
    act(() => result.current.history.undo());
    change(result, "a", "c");
    act(() => result.current.history.clear());
    expect(result.current.history).toMatchObject({ canUndo: false, canRedo: false });
  });

  it("calls onNavigate after an undo or a redo, and only then", () => {
    const onNavigate = vi.fn();
    const { result } = render(onNavigate);
    act(() => result.current.history.undo());
    act(() => result.current.history.redo());
    change(result, "a", "b");
    expect(onNavigate).not.toHaveBeenCalled();
    act(() => result.current.history.undo());
    act(() => result.current.history.redo());
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});
