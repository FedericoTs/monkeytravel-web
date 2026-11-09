import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Activity, ItineraryDay } from "@/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => (values ? `${key}:${values.count}` : key),
}));

import { useStopEdit } from "./useStopEdit";

// Stops with no location: an unknown journey counts as 30 minutes.
const stop = (name: string, start: string, duration: number) =>
  ({ id: name, name, type: "attraction", start_time: start, duration_minutes: duration }) as unknown as Activity;
const day = (...activities: Activity[]) => ({ day_number: 1, date: "2026-12-21", activities }) as ItineraryDay;
const times = (plan: ItineraryDay[]) => plan[0].activities.map((a) => `${a.start_time} ${a.name}`);
const plan = () => [day(stop("Museum", "09:00", 120), stop("Lunch", "12:00", 60), stop("Garden", "14:00", 90))];

function setup(itinerary: ItineraryDay[]) {
  const setItinerary = vi.fn();
  const pushUndo = vi.fn();
  const notifyUndoable = vi.fn();
  const hook = renderHook(({ current }) => useStopEdit({ itinerary: current, setItinerary, pushUndo, notifyUndoable }), {
    initialProps: { current: itinerary },
  });
  return { ...hook, setItinerary, pushUndo, notifyUndoable };
}

describe("useStopEdit's edit", () => {
  it("saves the stop with room made after it, and says how many stops moved, with Undo", () => {
    const { result, setItinerary, pushUndo, notifyUndoable } = setup(plan());
    result.current.editStop("Museum", { duration_minutes: 300 });
    expect(pushUndo).toHaveBeenCalledWith("Update activity");
    expect(pushUndo.mock.invocationCallOrder[0]).toBeLessThan(setItinerary.mock.invocationCallOrder[0]);
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "14:30 Lunch", "16:00 Garden"]);
    expect(notifyUndoable).toHaveBeenCalledWith("editActivity.madeRoom:2");
  });

  it("says nothing more when no other stop moved", () => {
    const { result, setItinerary, notifyUndoable } = setup(plan());
    result.current.editStop("Lunch", { name: "Ramen" });
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "12:00 Ramen", "14:00 Garden"]);
    expect(notifyUndoable).not.toHaveBeenCalled();
  });

  // A card that hasn't re-rendered calls the handler of an earlier render: the
  // edit must land on the plan as it is now, or a stop added since is lost.
  it("edits the plan as it is now, not as it was when the handler was made", () => {
    const { result, rerender, setItinerary } = setup(plan());
    const handlerFromBefore = result.current.editStop;
    rerender({ current: [day(...plan()[0].activities, stop("Tea", "17:00", 30))] });
    handlerFromBefore("Lunch", { name: "Ramen" });
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "12:00 Ramen", "14:00 Garden", "17:00 Tea"]);
  });
});

describe("useStopEdit's new stop", () => {
  it("adds it at its time, and says how many stops moved to make room, with Undo", () => {
    const { result, setItinerary, pushUndo, notifyUndoable } = setup(plan());
    result.current.addStop(0, stop("Tea", "12:00", 60));
    expect(pushUndo).toHaveBeenCalledWith("Add activity");
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "12:00 Tea", "13:30 Lunch", "15:00 Garden"]);
    expect(notifyUndoable).toHaveBeenCalledWith("editActivity.madeRoom:2");
  });

  it("says nothing more when it fits", () => {
    const { result, setItinerary, notifyUndoable } = setup(plan());
    result.current.addStop(0, stop("Tea", "16:30", 30));
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "12:00 Lunch", "14:00 Garden", "16:30 Tea"]);
    expect(notifyUndoable).not.toHaveBeenCalled();
  });

  it("adds to the plan as it is now", () => {
    const { result, rerender, setItinerary } = setup(plan());
    const handlerFromBefore = result.current.addStop;
    rerender({ current: [day(...plan()[0].activities, stop("Bar", "20:00", 60))] });
    handlerFromBefore(0, stop("Tea", "16:30", 30));
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "12:00 Lunch", "14:00 Garden", "16:30 Tea", "20:00 Bar"]);
  });
});

describe("useStopEdit's room after a stop", () => {
  // The museum runs to 13:00, into lunch at 12:00.
  const overlapping = () => [day(stop("Museum", "09:00", 240), stop("Lunch", "12:00", 60), stop("Garden", "16:00", 90))];

  it("moves the later stops only as much as they must, and says how many, with Undo", () => {
    const { result, setItinerary, pushUndo, notifyUndoable } = setup(overlapping());
    result.current.makeRoom("Museum");
    expect(pushUndo).toHaveBeenCalledWith("Make room");
    // 13:00 and the 30 minutes of an unknown journey; the garden already had room.
    expect(times(setItinerary.mock.calls[0][0])).toEqual(["09:00 Museum", "13:30 Lunch", "16:00 Garden"]);
    expect(notifyUndoable).toHaveBeenCalledWith("editActivity.madeRoom:1");
  });

  it("changes nothing for a stop it doesn't hold", () => {
    const plan = overlapping();
    const { result, setItinerary, notifyUndoable } = setup(plan);
    result.current.makeRoom("nowhere");
    expect(setItinerary.mock.calls[0][0]).toBe(plan);
    expect(notifyUndoable).not.toHaveBeenCalled();
  });
});
