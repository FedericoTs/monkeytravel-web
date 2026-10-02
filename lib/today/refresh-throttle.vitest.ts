import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepIfSame, throttledRefresh } from "./refresh-throttle";

/**
 * A busy group can change many things at once. However many events arrive, a
 * screen refreshes at most once per gap, never twice at once, and always once
 * more after the last event.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A refresh that takes `ms` to finish. */
const slowRefresh = (ms: number) => {
  const runs: number[] = [];
  const run = vi.fn(async () => {
    runs.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  return { run, runs };
};

describe("throttledRefresh", () => {
  it("refreshes at once for the first event", async () => {
    const { run } = slowRefresh(100);
    throttledRefresh(run, 3_000).request();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("turns a burst into one refresh now and one after the gap", async () => {
    const { run, runs } = slowRefresh(100);
    const refresh = throttledRefresh(run, 3_000);
    for (let i = 0; i < 500; i++) {
      refresh.request();
      await vi.advanceTimersByTimeAsync(5);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    // 2.5s of events: the first refresh, then one trailing refresh after the gap.
    expect(run).toHaveBeenCalledTimes(2);
    expect(runs[1] - runs[0]).toBeGreaterThanOrEqual(3_000);
  });

  it("keeps steady events to one refresh per gap", async () => {
    const { run } = slowRefresh(50);
    const refresh = throttledRefresh(run, 3_000);
    for (let i = 0; i < 300; i++) {
      refresh.request();
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    // 30s of events every 100ms: about one refresh per 3s, plus the trailing one.
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(run.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("never runs two refreshes at once", async () => {
    let running = 0;
    let most = 0;
    const run = vi.fn(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      running--;
    });
    const refresh = throttledRefresh(run, 1_000);
    for (let i = 0; i < 50; i++) {
      refresh.request();
      await vi.advanceTimersByTimeAsync(300);
    }
    await vi.advanceTimersByTimeAsync(30_000);
    expect(most).toBe(1);
  });

  it("keeps going after a refresh fails", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const refresh = throttledRefresh(run, 1_000);
    refresh.request();
    await vi.advanceTimersByTimeAsync(0);
    refresh.request();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("still refreshes within the gap after the device clock goes back", async () => {
    const { run } = slowRefresh(10);
    const refresh = throttledRefresh(run, 3_000);
    refresh.request();
    await vi.advanceTimersByTimeAsync(100);
    vi.setSystemTime(Date.now() - 10 * 60_000);
    refresh.request();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops a waiting refresh when the screen goes away", async () => {
    const { run } = slowRefresh(10);
    const refresh = throttledRefresh(run, 3_000);
    refresh.request();
    await vi.advanceTimersByTimeAsync(100);
    refresh.request();
    refresh.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("keepIfSame", () => {
  it("keeps the old value when nothing changed, so nothing re-renders", () => {
    const prev = [{ id: "a", n: 1 }];
    expect(keepIfSame(prev, [{ id: "a", n: 1 }])).toBe(prev);
    const next = [{ id: "a", n: 2 }];
    expect(keepIfSame(prev, next)).toBe(next);
  });
});
