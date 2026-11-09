import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const addToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { useUndoToast } from "./useUndoToast";

describe("useUndoToast", () => {
  it("says what changed, with an Undo that takes back the change", () => {
    const undo = vi.fn();
    const { result } = renderHook(() => useUndoToast(undo));

    result.current("Removed Gion");
    expect(addToast).toHaveBeenCalledWith("Removed Gion", "success", 6000, { label: "detail.undo", onClick: expect.any(Function) });
    addToast.mock.calls[0][3].onClick();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  // The toast stays up for seconds while the page re-renders: its Undo must
  // call the undo of the plan as it is then, not the one of the render that
  // showed it.
  it("calls the undo current when Undo is clicked", () => {
    addToast.mockClear();
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ undo }) => useUndoToast(undo), { initialProps: { undo: first } });

    result.current("Removed Gion");
    rerender({ undo: latest });
    addToast.mock.calls[0][3].onClick();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
