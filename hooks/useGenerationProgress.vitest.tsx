/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SseDayData, SseOutlineData } from "@/lib/streaming/sse";
import { useGenerationProgress } from "./useGenerationProgress";

/**
 * The wizard's progress view shows a plan as it streams in: a long trip's
 * outline, its length, then each day as it arrives. A new try starts over.
 */

const day = (n: number) => ({ day_number: n, date: `2027-05-${9 + n}` }) as SseDayData;
const outline = [{ day_number: 1, theme: "Old town", area: "Alfama", places: [] }] as unknown as SseOutlineData["days"];

describe("useGenerationProgress", () => {
  it("shows the outline, the length and each day in the order they arrive", () => {
    const { result } = renderHook(() => useGenerationProgress());
    act(() => {
      result.current.progress.total(3);
      result.current.progress.outline(outline);
      result.current.progress.day(day(1));
      result.current.progress.day(day(2));
    });
    expect(result.current.totalDays).toBe(3);
    expect(result.current.outline).toEqual(outline);
    expect(result.current.days.map((d) => d.day_number)).toEqual([1, 2]);
  });

  it("starts over for a new try", () => {
    const { result } = renderHook(() => useGenerationProgress());
    act(() => {
      result.current.progress.total(3);
      result.current.progress.outline(outline);
      result.current.progress.day(day(1));
      result.current.progress.reset();
    });
    expect(result.current).toMatchObject({ days: [], outline: [], totalDays: 0 });
  });

  it("hands the same progress to every render, so a try in flight keeps reporting into it", () => {
    const { result, rerender } = renderHook(() => useGenerationProgress());
    const first = result.current.progress;
    act(() => result.current.progress.day(day(1)));
    rerender();
    expect(result.current.progress).toBe(first);
  });
});
