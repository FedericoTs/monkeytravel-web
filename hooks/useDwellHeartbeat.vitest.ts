import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDwellHeartbeat } from "./useDwellHeartbeat";

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDwellHeartbeat", () => {
  it("beats every 10 seconds while active", () => {
    const beat = vi.fn();
    renderHook(() => useDwellHeartbeat(true, beat));
    vi.advanceTimersByTime(9_999);
    expect(beat).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(beat).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(beat).toHaveBeenCalledTimes(3);
  });

  it("stops after 18 beats", () => {
    const beat = vi.fn();
    renderHook(() => useDwellHeartbeat(true, beat));
    vi.advanceTimersByTime(60 * 60_000);
    expect(beat).toHaveBeenCalledTimes(18);
  });

  it("doesn't beat or count while the tab is hidden", () => {
    const beat = vi.fn();
    renderHook(() => useDwellHeartbeat(true, beat));
    visibility = "hidden";
    vi.advanceTimersByTime(60 * 60_000);
    expect(beat).not.toHaveBeenCalled();
    visibility = "visible";
    vi.advanceTimersByTime(18 * 10_000);
    expect(beat).toHaveBeenCalledTimes(18);
  });

  it("does nothing while inactive, and stops when it turns inactive", () => {
    const beat = vi.fn();
    const { rerender, unmount } = renderHook(({ active }) => useDwellHeartbeat(active, beat), {
      initialProps: { active: false },
    });
    vi.advanceTimersByTime(30_000);
    expect(beat).not.toHaveBeenCalled();
    rerender({ active: true });
    vi.advanceTimersByTime(10_000);
    expect(beat).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    vi.advanceTimersByTime(30_000);
    expect(beat).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("calls the latest beat without restarting the count", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ beat }) => useDwellHeartbeat(true, beat), {
      initialProps: { beat: first },
    });
    vi.advanceTimersByTime(10_000);
    rerender({ beat: second });
    vi.advanceTimersByTime(17 * 10_000 + 60_000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(17);
  });
});
