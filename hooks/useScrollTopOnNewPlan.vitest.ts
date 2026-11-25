// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useScrollTopOnNewPlan } from "./useScrollTopOnNewPlan";

const scrollTo = vi.fn();
beforeEach(() => {
  scrollTo.mockClear();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});

type Props = { plan: object | null; planNumber: number };
const mount = (first: Props) => renderHook((p: Props) => useScrollTopOnNewPlan(p.plan, p.planNumber), { initialProps: first });

describe("the page goes to the top for a new plan, and stays put while the same plan changes", () => {
  it("goes to the top when a plan arrives, not before", () => {
    const { rerender } = mount({ plan: null, planNumber: 1 });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ plan: { days: [] }, planNumber: 1 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("leaves the reader where they are when the same plan is replaced by its photos or an edit", () => {
    const { rerender } = mount({ plan: { days: [] }, planNumber: 1 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    rerender({ plan: { days: [], photos: true }, planNumber: 1 });
    rerender({ plan: { days: [], edited: true }, planNumber: 1 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("goes to the top for another plan swapped in while one is shown", () => {
    const { rerender } = mount({ plan: { id: "a" }, planNumber: 1 });
    rerender({ plan: { id: "b" }, planNumber: 2 });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("goes to the top again for a plan made again after the last was cleared", () => {
    const { rerender } = mount({ plan: { id: "a" }, planNumber: 1 });
    rerender({ plan: null, planNumber: 2 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    rerender({ plan: { id: "c" }, planNumber: 2 });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
