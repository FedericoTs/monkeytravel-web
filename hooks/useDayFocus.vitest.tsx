import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { useDayFocus } from "./useDayFocus";

/**
 * APPLY → SEE: focusing a day scrolls its card into view once the plan has
 * committed and highlights it for 2.2 s, clearing a day filter that would hide
 * it and closing the assistant where it covers the plan.
 */

function screen({ width = 1440, reducedMotion = false } = {}) {
  window.matchMedia = ((query: string) => ({ matches: reducedMotion && query.includes("reduce"), media: query })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function card(day: number) {
  const el = document.createElement("div");
  el.id = `trip-day-${day}`;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

function setup() {
  const setSelectedDay = vi.fn();
  const setIsAIAssistantOpen = vi.fn();
  const view = renderHook(() => useDayFocus({ setSelectedDay, setIsAIAssistantOpen }));
  const focus = (day: number) => act(() => view.result.current.focusDay(day));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { view, focus, wait, setSelectedDay, setIsAIAssistantOpen };
}

beforeEach(() => {
  vi.useFakeTimers();
  screen();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useDayFocus", () => {
  it("highlights the day with a pulse, scrolls its card into view once the plan has committed, and lets go after 2.2 s", async () => {
    const day2 = card(2);
    const { view, focus, wait } = setup();
    await focus(2);
    expect(view.result.current.focusedDay).toEqual({ day: 2, pulse: true });
    await wait(99);
    expect(day2.scrollIntoView).not.toHaveBeenCalled();
    await wait(1);
    expect(day2.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    await wait(2099);
    expect(view.result.current.focusedDay).toEqual({ day: 2, pulse: true });
    await wait(1);
    expect(view.result.current.focusedDay).toBeNull();
  });

  it("under reduced motion, highlights without a pulse and jumps to the card", async () => {
    screen({ reducedMotion: true });
    const day2 = card(2);
    const { view, focus, wait } = setup();
    await focus(2);
    expect(view.result.current.focusedDay).toEqual({ day: 2, pulse: false });
    await wait(100);
    expect(day2.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("clears a day filter showing another day, and keeps one showing this day", async () => {
    const { focus, setSelectedDay } = setup();
    await focus(2);
    const update = setSelectedDay.mock.calls[0][0] as (prev: number | null) => number | null;
    expect([update(null), update(2), update(3)]).toEqual([null, 2, null]);
  });

  it("closes the assistant below 1024 px, where it covers the plan, and leaves it open from 1024 px", async () => {
    screen({ width: 1023 });
    const narrow = setup();
    await narrow.focus(2);
    expect(narrow.setIsAIAssistantOpen).toHaveBeenCalledWith(false);
    cleanup();

    screen({ width: 1024 });
    const wide = setup();
    await wide.focus(2);
    expect(wide.setIsAIAssistantOpen).not.toHaveBeenCalled();
  });

  it("gives a second focus its own 2.2 s", async () => {
    const { view, focus, wait } = setup();
    await focus(2);
    await wait(2000);
    await focus(3);
    await wait(2199);
    expect(view.result.current.focusedDay).toEqual({ day: 3, pulse: true });
    await wait(1);
    expect(view.result.current.focusedDay).toBeNull();
  });

  it("highlights a day whose card is not on the page, without scrolling", async () => {
    const { view, focus, wait } = setup();
    await focus(9);
    await wait(100);
    expect(view.result.current.focusedDay).toEqual({ day: 9, pulse: true });
  });

  it("keeps focusDay the same function from render to render", () => {
    const { view } = setup();
    const first = view.result.current.focusDay;
    view.rerender();
    expect(view.result.current.focusDay).toBe(first);
  });
});
