/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./retry";

/**
 * An outside service that never answered held a request until the platform cut
 * it off at five minutes. Each attempt now gives up after its time limit, and a
 * retry gets a limit of its own.
 */

/** A fetch that never answers, and gives up when its signal aborts. */
const hangingFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
      }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchWithRetry's time limit", () => {
  it("gives up on an attempt with no answer, tries once more, then fails", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const settled = fetchWithRetry("https://archive-api.open-meteo.com/v1/archive", {}, { maxRetries: 1, timeoutMs: 8000 }).then(
      () => "answered",
      (e: Error) => `failed: ${e.message}`,
    );
    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The first attempt gives up at 8 s; the retry starts after its pause (2 s at most here).
    await vi.advanceTimersByTimeAsync(1 + 2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await settled).toBe("failed: No answer in 8000 ms");
  });

  it("returns a quick answer as it came, and leaves no timer behind", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const res = await fetchWithRetry("https://example.com/api", {}, { maxRetries: 1, timeoutMs: 8000 });
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the caller's own signal, and adds no limit of its own then", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const own = new AbortController();
    await fetchWithRetry("https://example.com/api", { signal: own.signal }, { maxRetries: 0, timeoutMs: 8000 });
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(own.signal);
  });
});
