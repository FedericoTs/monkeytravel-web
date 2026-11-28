// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { GeneratedItinerary } from "@/types";
import { useGeneratedPlan } from "./useGeneratedPlan";

const planOf = (...activities: Array<Record<string, unknown>>) =>
  ({ days: [{ day_number: 1, activities }] }) as unknown as GeneratedItinerary;
const ids = (plan: GeneratedItinerary | null) => plan?.days[0].activities.map((a) => a.id);

function open() {
  const { result } = renderHook(() => useGeneratedPlan());
  return {
    plan: () => result.current[0],
    set: (next: Parameters<(typeof result.current)[1]>[0]) => act(() => result.current[1](next)),
  };
}

describe("the wizard's plan", () => {
  it("starts empty", () => {
    expect(open().plan()).toBeNull();
  });

  it("gives an id to an activity that has none, and keeps one it has", () => {
    const wizard = open();
    wizard.set(planOf({ name: "Alfama" }, { id: "act_kept", name: "Belem" }));
    const [given, kept] = ids(wizard.plan())!;
    expect(given).toMatch(/^act_/);
    expect(kept).toBe("act_kept");
  });

  it("keeps the ids it gave when the plan is set again", () => {
    const wizard = open();
    wizard.set(planOf({ name: "Alfama" }));
    const first = ids(wizard.plan());
    wizard.set((prev) => prev && { ...prev, days: [...prev.days] });
    expect(ids(wizard.plan())).toEqual(first);
  });

  it("stays the same object when no id is missing, so the auto-save sees no new plan", () => {
    const wizard = open();
    const complete = planOf({ id: "act_kept", name: "Belem" });
    wizard.set(complete);
    expect(wizard.plan()).toBe(complete);
    wizard.set((prev) => prev);
    expect(wizard.plan()).toBe(complete);
  });

  it("takes an update built from the plan it holds", () => {
    const wizard = open();
    wizard.set(planOf({ id: "a", name: "Alfama" }));
    wizard.set((prev) => prev && { ...prev, days: [...prev.days, { day_number: 2, activities: [] }] as never });
    expect(wizard.plan()?.days).toHaveLength(2);
  });

  it("can be cleared, and lets through a plan with no days to look at", () => {
    const wizard = open();
    wizard.set(planOf({ name: "Alfama" }));
    wizard.set(null);
    expect(wizard.plan()).toBeNull();
    const odd = { days: "none" } as unknown as GeneratedItinerary;
    wizard.set(odd);
    expect(wizard.plan()).toBe(odd);
  });
});

describe("the plan's note of what was checked", () => {
  const CHECKED = { sights: 2, shut: 1, fixed: 1, left: 0 };
  const checkedPlan = () =>
    ({
      checked: CHECKED,
      days: [
        { day_number: 1, date: "2027-05-10", activities: [{ id: "a1", name: "Alfama" }, { id: "a2", name: "Belem" }] },
        { day_number: 2, date: "2027-05-11", activities: [{ id: "a3", name: "Sintra" }] },
      ],
    }) as unknown as GeneratedItinerary;
  const change = (plan: GeneratedItinerary, day: number, over: Record<string, unknown>) =>
    ({ ...plan, days: plan.days.map((d, i) => (i === day ? { ...d, ...over } : d)) }) as GeneratedItinerary;

  it("arrives with the plan and stays while the plan is as it was checked", () => {
    const wizard = open();
    wizard.set(checkedPlan());
    expect(wizard.plan()?.checked).toEqual(CHECKED);
    // A photo found for a stop changes neither a date nor a stop.
    wizard.set((prev) => prev && change(prev, 0, { activities: prev.days[0].activities.map((a) => ({ ...a, image_url: "/photo.jpg" })) }));
    expect(wizard.plan()?.checked).toEqual(CHECKED);
  });

  it("goes when a stop is changed in the browser", () => {
    const wizard = open();
    wizard.set(checkedPlan());
    wizard.set((prev) => prev && change(prev, 0, { activities: [{ id: "a1", name: "Alfama" }, { id: "a9", name: "LX Factory" }] }));
    expect(wizard.plan()).not.toHaveProperty("checked");
    expect(wizard.plan()?.days[0].activities[1].name).toBe("LX Factory");
  });

  it("goes when a day's date is changed, or a day is added", () => {
    const wizard = open();
    wizard.set(checkedPlan());
    wizard.set((prev) => prev && change(prev, 1, { date: "2027-05-13" }));
    expect(wizard.plan()).not.toHaveProperty("checked");
    const longer = open();
    longer.set(checkedPlan());
    longer.set((prev) => prev && ({ ...prev, days: [...prev.days, { day_number: 3, date: "2027-05-12", activities: [] }] } as unknown as GeneratedItinerary));
    expect(longer.plan()).not.toHaveProperty("checked");
  });

  it("goes when the stops trade places, which is what the check is about", () => {
    const wizard = open();
    wizard.set(checkedPlan());
    wizard.set((prev) => prev && change(prev, 0, { activities: [...prev.days[0].activities].reverse() }));
    expect(wizard.plan()).not.toHaveProperty("checked");
  });

  it("comes back with the checked days when a change is undone", () => {
    const wizard = open();
    const checked = checkedPlan();
    wizard.set(checked);
    const before = wizard.plan()!;
    wizard.set((prev) => prev && change(prev, 0, { activities: [{ id: "a9", name: "LX Factory" }] }));
    expect(wizard.plan()).not.toHaveProperty("checked");
    wizard.set(before);
    expect(wizard.plan()?.checked).toEqual(CHECKED);
  });

  it("is taken as it comes with a new plan, whatever the plan before it was", () => {
    const wizard = open();
    wizard.set(checkedPlan());
    const next = { ...checkedPlan(), checked: { sights: 5, shut: 0, fixed: 0, left: 0 }, days: [{ day_number: 1, date: "2027-06-01", activities: [{ id: "b1", name: "Uffizi" }] }] } as unknown as GeneratedItinerary;
    wizard.set(next);
    expect(wizard.plan()?.checked).toEqual({ sights: 5, shut: 0, fixed: 0, left: 0 });
  });
});
