/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Activity, GeneratedItinerary } from "@/types";
import type { AssistantDayEdit } from "@/lib/trips/day-edit-merge";
import { withFoundPhotos } from "@/lib/trips/keep-place-photos";
import { useAssistantEdits } from "./useAssistantEdits";

/**
 * The assistant's edits apply to the plan on screen as they arrive, and one can
 * be undone while the plan is still that edit's result, apart from photos found
 * since, so Undo never wipes a change made since.
 */

const activity = (name: string): Activity =>
  ({ id: `id-${name}`, name, estimated_cost: { amount: 10, currency: "EUR" } }) as unknown as Activity;
const plan = (): GeneratedItinerary =>
  ({
    destination: { name: "Prague", country: "Czechia" },
    days: [
      { day_number: 1, date: "2026-12-01", activities: [activity("Castle")] },
      { day_number: 2, date: "2026-12-02", activities: [activity("Bridge")] },
    ],
  }) as unknown as GeneratedItinerary;
const edit = (day_number: number, name: string): AssistantDayEdit => ({ day_number, activities: [activity(name)] });
const names = (p: GeneratedItinerary | null) => p?.days.map((d) => d.activities.map((a) => a.name).join("+"));

/** Renders the hook over a plan and dates held like the planner holds them. */
function show(initial: GeneratedItinerary | null = plan(), startDate = "2026-12-01") {
  const noteEditApplied = vi.fn();
  const hook = renderHook(() => {
    const [current, setPlan] = useState(initial);
    const [start, setStart] = useState(startDate);
    const [end, setEnd] = useState("2026-12-02");
    const edits = useAssistantEdits({
      plan: current,
      onPlan: setPlan,
      startDate: start,
      endDate: end,
      onEndDate: setEnd,
      noteEditApplied,
    });
    return { plan: current, setPlan, start, setStart, end, setEnd, ...edits };
  });
  return { noteEditApplied, now: () => hook.result.current };
}

// An edit scrolls to its day on a timer, which must not outlive the test's document.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("applying a reply", () => {
  it("changes the days it names, and notes that the plan has edits", () => {
    const { now, noteEditApplied } = show();
    expect(now().hasEdits()).toBe(false);
    let undoId: string | undefined;
    act(() => {
      undoId = now().applyEdits([edit(2, "Museum")]);
    });
    expect(names(now().plan)).toEqual(["Castle", "Museum"]);
    expect(undoId).toEqual(expect.any(String));
    expect(noteEditApplied).toHaveBeenCalledTimes(1);
    expect(now().hasEdits()).toBe(true);
    expect(now().end).toBe("2026-12-02");
  });

  it("gives every activity an id, on the days it did not change too", () => {
    const noId = plan();
    noId.days[1].activities = [{ name: "Bridge" } as Activity];
    const { now } = show(noId);
    act(() => {
      now().applyEdits([{ day_number: 1, activities: [{ name: "Market" } as Activity] }]);
    });
    expect(now().plan!.days.flatMap((d) => d.activities).every((a) => a.id)).toBe(true);
  });

  it("recomputes the trip's total", () => {
    const { now } = show();
    const before = now().plan!.trip_summary?.total_estimated_cost;
    act(() => {
      now().applyEdits([{ day_number: 2, activities: [activity("Museum"), activity("Opera")] }]);
    });
    expect(now().plan!.trip_summary?.total_estimated_cost).not.toBe(before);
  });

  it("two replies before a render build on each other", () => {
    const { now } = show();
    act(() => {
      now().applyEdits([edit(1, "Market")]);
      now().applyEdits([edit(2, "Museum")]);
    });
    expect(names(now().plan)).toEqual(["Market", "Museum"]);
  });

  it("a new length moves the end date, from the current start date", () => {
    const { now } = show();
    act(() => now().setStart("2026-12-10"));
    act(() => {
      now().applyEdits([edit(3, "Lake")], 3);
    });
    expect(now().plan!.days).toHaveLength(3);
    expect(now().plan!.days[2].date).toBe("2026-12-12");
    expect(now().end).toBe("2026-12-12");
  });

  it("a new length with no start date leaves the end date alone", () => {
    const { now } = show(plan(), "");
    act(() => {
      now().applyEdits([edit(3, "Lake")], 3);
    });
    expect(now().plan!.days).toHaveLength(3);
    expect(now().end).toBe("2026-12-02");
  });

  it("with no plan on screen does nothing", () => {
    const { now, noteEditApplied } = show(null);
    let undoId: string | undefined = "unset";
    act(() => {
      undoId = now().applyEdits([edit(1, "Market")]);
    });
    expect(undoId).toBeUndefined();
    expect(noteEditApplied).not.toHaveBeenCalled();
    expect(now().hasEdits()).toBe(false);
    expect(now().plan).toBeNull();
  });

  it("a generation forgets the plan had edits", () => {
    const { now } = show();
    act(() => {
      now().applyEdits([edit(1, "Market")]);
    });
    act(() => now().forgetEdits());
    expect(now().hasEdits()).toBe(false);
  });
});

describe("showing what changed", () => {
  function dayOnPage(n: number) {
    const el = document.createElement("div");
    el.id = `day-${n}`;
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    return el;
  }

  it("scrolls to the first changed day and rings it for a moment", () => {
    const first = dayOnPage(1);
    const second = dayOnPage(2);
    const { now } = show();
    act(() => {
      now().applyEdits([edit(2, "Museum"), edit(1, "Market")]);
    });
    expect(second.scrollIntoView).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(second.classList.contains("ring-2")).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(second.classList.contains("ring-2")).toBe(false);
  });

  it("a reply that only changes the length scrolls to the new last day", () => {
    const last = dayOnPage(3);
    const { now } = show();
    act(() => {
      now().applyEdits([], 3);
    });
    act(() => vi.advanceTimersByTime(100));
    expect(last.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("undoing a reply", () => {
  function applied(edits: AssistantDayEdit[], tripLength?: number) {
    const shown = show();
    const original = shown.now().plan;
    let undoId = "";
    act(() => {
      undoId = shown.now().applyEdits(edits, tripLength)!;
    });
    return { ...shown, original, undoId };
  }
  const undo = (now: ReturnType<typeof show>["now"], id: string) => {
    let done = false;
    act(() => {
      done = now().undoEdits(id);
    });
    return done;
  };

  it("puts back the plan and the end date, once", () => {
    const { now, original, undoId } = applied([edit(3, "Lake")], 3);
    expect(now().end).toBe("2026-12-03");
    expect(undo(now, undoId)).toBe(true);
    expect(now().plan).toEqual(original);
    expect(now().end).toBe("2026-12-02");
    expect(undo(now, undoId)).toBe(false);
  });

  it("puts back the end date as it was when the edit applied", () => {
    const { now } = show();
    act(() => now().setEnd("2026-12-05"));
    let undoId = "";
    act(() => {
      undoId = now().applyEdits([edit(3, "Lake")], 3)!;
    });
    expect(now().end).toBe("2026-12-03");
    expect(undo(now, undoId)).toBe(true);
    expect(now().end).toBe("2026-12-05");
  });

  it("is refused once a later reply has changed the plan, and the later one undoes first", () => {
    const { now, original, undoId } = applied([edit(1, "Market")]);
    let later = "";
    act(() => {
      later = now().applyEdits([edit(2, "Museum")])!;
    });
    expect(undo(now, undoId)).toBe(false);
    expect(names(now().plan)).toEqual(["Market", "Museum"]);
    expect(undo(now, later)).toBe(true);
    expect(names(now().plan)).toEqual(["Market", "Bridge"]);
    expect(undo(now, undoId)).toBe(true);
    expect(now().plan).toEqual(original);
  });

  it("once every reply is undone, the plan has no edits to lose", () => {
    const { now, undoId } = applied([edit(1, "Market")]);
    let later = "";
    act(() => {
      later = now().applyEdits([edit(2, "Museum")])!;
    });
    undo(now, later);
    expect(now().hasEdits()).toBe(true);
    undo(now, undoId);
    expect(now().hasEdits()).toBe(false);
  });

  it("an undo after a generation that kept the plan doesn't hide the next edit", () => {
    const { now, undoId } = applied([edit(1, "Market")]);
    act(() => now().forgetEdits());
    expect(undo(now, undoId)).toBe(true);
    act(() => {
      now().applyEdits([edit(2, "Museum")]);
    });
    expect(now().hasEdits()).toBe(true);
  });

  it("a refused undo leaves the edits counted", () => {
    const { now, undoId } = applied([edit(1, "Market")]);
    act(() => now().setPlan(plan()));
    expect(undo(now, undoId)).toBe(false);
    expect(now().hasEdits()).toBe(true);
  });

  it("two undos before a render take back both replies", () => {
    const { now, original, undoId } = applied([edit(1, "Market")]);
    let later = "";
    act(() => {
      later = now().applyEdits([edit(2, "Museum")])!;
    });
    const undone: boolean[] = [];
    act(() => {
      undone.push(now().undoEdits(later), now().undoEdits(undoId));
    });
    expect(undone).toEqual([true, true]);
    expect(now().plan).toEqual(original);
  });

  describe("after photos found since", () => {
    const WIKI = "/api/images/wikimedia/abc-500.jpg?a=X&l=CC0&f=Y.jpg";
    const found = (now: ReturnType<typeof show>["now"], photos: Record<string, string>) =>
      act(() => {
        const current = now().plan!;
        now().setPlan({ ...current, days: withFoundPhotos(current.days, photos) });
      });
    const photoOf = (p: GeneratedItinerary | null, name: string) =>
      p?.days.flatMap((d) => d.activities).find((a) => a.name === name)?.image_url;

    it("still works, and they stay on the activities still there", () => {
      const { now, undoId } = applied([edit(1, "Market")]);
      found(now, { "id-Bridge": WIKI });
      expect(photoOf(now().plan, "Bridge")).toBe(WIKI);
      expect(undo(now, undoId)).toBe(true);
      expect(names(now().plan)).toEqual(["Castle", "Bridge"]);
      expect(photoOf(now().plan, "Bridge")).toBe(WIKI);
    });

    it("works for each reply in turn", () => {
      const { now, original, undoId } = applied([edit(1, "Market")]);
      let later = "";
      act(() => {
        later = now().applyEdits([edit(1, "Museum")])!;
      });
      found(now, { "id-Bridge": WIKI });
      expect(undo(now, later)).toBe(true);
      expect(names(now().plan)).toEqual(["Market", "Bridge"]);
      expect(undo(now, undoId)).toBe(true);
      expect(names(now().plan)).toEqual(names(original));
      expect(photoOf(now().plan, "Bridge")).toBe(WIKI);
    });

    it("is still refused when something besides photos has changed too", () => {
      const { now, undoId } = applied([edit(1, "Market")]);
      found(now, { "id-Bridge": WIKI });
      act(() => {
        const current = now().plan!;
        now().setPlan({ ...current, days: current.days.slice(0, 1) });
      });
      expect(undo(now, undoId)).toBe(false);
      expect(names(now().plan)).toEqual(["Market"]);
    });
  });

  it("is refused once anything else has replaced the plan", () => {
    const { now, undoId } = applied([edit(1, "Market")]);
    const other = plan();
    act(() => now().setPlan(other));
    expect(undo(now, undoId)).toBe(false);
    expect(now().plan).toBe(other);
    expect(now().end).toBe("2026-12-02");
  });

  it("is refused for what it never recorded, and with no plan on screen", () => {
    const { now, undoId } = applied([edit(1, "Market")]);
    expect(undo(now, "edit-999")).toBe(false);
    act(() => now().setPlan(null));
    expect(undo(now, undoId)).toBe(false);
    expect(now().plan).toBeNull();
  });
});
