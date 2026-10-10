/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTodayActions } from "./useTodayActions";

/**
 * A screen on Today refreshes its chips and its expense panel when the trip's
 * channel says something changed, but a flood of events costs one refresh now
 * and one after the gap.
 */

let onChanged: (() => void) | null = null;
vi.mock("@/lib/supabase/client", () => {
  const channel = {
    on: (_type: string, _filter: unknown, handler: () => void) => {
      onChanged = handler;
      return channel;
    },
    subscribe: () => channel,
  };
  return { createClient: () => ({ channel: () => channel, removeChannel: () => undefined }) };
});

const reads: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  reads.length = 0;
  onChanged = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      reads.push(url);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useTodayActions", () => {
  it("refreshes the chips and the expenses on a change, at most once per gap", async () => {
    const alsoRefresh = vi.fn(async () => undefined);
    renderHook(() => useTodayActions("/api/shared/token-1", "trip-1", true, alsoRefresh));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toEqual(["/api/shared/token-1/today-actions"]);

    await act(async () => {
      for (let i = 0; i < 200; i++) {
        onChanged?.();
        await vi.advanceTimersByTimeAsync(5);
      }
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // 200 events in a second: one refresh at once and one after the gap.
    expect(reads.filter((u) => u.endsWith("/today-actions"))).toHaveLength(3);
    expect(alsoRefresh).toHaveBeenCalledTimes(2);
  });
});

describe("useTodayActions errors", () => {
  /** Reads find no actions; every write answers with `write()`. */
  function stubWrites(write: () => Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST" ? write() : new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );
  }

  async function tapRunningLate() {
    const { result } = renderHook(() => useTodayActions("/api/shared/token-1", "trip-1", true));
    await act(async () => {
      await result.current.apply({ action_type: "running_late", day_number: 1 });
    });
    return result.current.error;
  }

  it("keeps the route's English out: a refused write is a key the screen translates", async () => {
    stubWrites(async () => new Response(JSON.stringify({ error: "Could not save that" }), { status: 500 }));
    expect(await tapRunningLate()).toBe("failed");
  });

  it("tells someone tapping too fast to wait", async () => {
    stubWrites(async () => new Response(JSON.stringify({ error: "Too many changes. Please slow down.", code: "RATE_LIMIT" }), { status: 429 }));
    expect(await tapRunningLate()).toBe("rateLimited");
  });

  it("treats a lost connection as a plain failure", async () => {
    stubWrites(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await tapRunningLate()).toBe("failed");
  });
});
