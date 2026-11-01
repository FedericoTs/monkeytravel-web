import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useActivitySearch } from "./useActivitySearch";

/** A fetch whose answers the test hands out, in any order. */
function controllableFetch() {
  const calls: { body: { query: string; types: string[]; includeGoogle: boolean }; signal: AbortSignal; answer: (names: string[]) => Promise<void> }[] = [];
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    let resolve!: (r: unknown) => void;
    const response = new Promise((r) => (resolve = r));
    calls.push({
      body: JSON.parse(init.body as string),
      signal: init.signal as AbortSignal,
      answer: async (names) => {
        resolve({ ok: true, json: async () => ({ results: names.map((name, i) => ({ id: `${name}-${i}`, name })) }) });
        await act(async () => {});
      },
    });
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const names = (results: { name: string }[]) => results.map((r) => r.name);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useActivitySearch", () => {
  it("loads suggestions only while asked to", async () => {
    const { calls } = controllableFetch();
    const { rerender } = renderHook(({ suggest }) => useActivitySearch("Lisbon", suggest), {
      initialProps: { suggest: false },
    });
    expect(calls).toHaveLength(0);

    rerender({ suggest: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ query: "", types: [], includeGoogle: false });
  });

  it("searches once, after the typing pauses", async () => {
    const { calls } = controllableFetch();
    const { result } = renderHook(() => useActivitySearch("Lisbon", false));

    act(() => result.current.changeQuery("B"));
    act(() => result.current.changeQuery("Be"));
    act(() => result.current.changeQuery("Bel"));
    expect(calls).toHaveLength(0);
    expect(result.current.query).toBe("Bel");

    act(() => vi.advanceTimersByTime(300));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ query: "Bel", includeGoogle: true });
  });

  it("keeps the newest results when an older search answers last", async () => {
    const { calls } = controllableFetch();
    const { result } = renderHook(() => useActivitySearch("Lisbon", false));

    act(() => result.current.toggleCategory("restaurant"));
    act(() => result.current.toggleCategory("museum"));
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].body.types).toEqual(["museum"]);

    await calls[1].answer(["Gulbenkian"]);
    await calls[0].answer(["Time Out Market"]);
    expect(names(result.current.results)).toEqual(["Gulbenkian"]);
    expect(result.current.isSearching).toBe(false);
  });

  it("toggles a category off again", async () => {
    const { calls } = controllableFetch();
    const { result } = renderHook(() => useActivitySearch("Lisbon", false));

    act(() => result.current.toggleCategory("museum"));
    act(() => result.current.toggleCategory("museum"));
    expect(result.current.category).toBeNull();
    expect(calls[1].body.types).toEqual([]);
  });

  it("reset clears the search, cancels what is pending and suggests again", async () => {
    const { calls } = controllableFetch();
    const { result } = renderHook(() => useActivitySearch("Lisbon", true));
    await calls[0].answer(["Belém Tower"]);
    expect(names(result.current.results)).toEqual(["Belém Tower"]);

    act(() => result.current.changeQuery("Alfama"));
    act(() => result.current.reset());
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.query).toBe("");
    // The typed search never ran; the reset asked for suggestions again.
    expect(calls.map((c) => c.body.query)).toEqual(["", ""]);
    await calls[1].answer(["Belém Tower", "Jerónimos"]);
    expect(names(result.current.results)).toEqual(["Belém Tower", "Jerónimos"]);
  });

  it("starts nothing and lands nothing after unmount", async () => {
    const { calls } = controllableFetch();
    const { result, unmount } = renderHook(() => useActivitySearch("Lisbon", true));
    act(() => result.current.changeQuery("Sintra"));
    unmount();

    expect(calls[0].signal.aborted).toBe(true);
    act(() => vi.advanceTimersByTime(300));
    expect(calls).toHaveLength(1);
  });
});
