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
