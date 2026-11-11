import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";

const store = new Map<string, string>();
const rememberAssistantSeen = vi.fn();
vi.mock("@/lib/safe-storage", () => ({
  safeGet: (key: string) => store.get(key) ?? null,
  safeSet: (key: string, value: string) => void store.set(key, value),
}));
vi.mock("@/lib/trip/assistant-seen", () => ({ rememberAssistantSeen: () => rememberAssistantSeen() }));

import { useAssistantFirstVisit } from "./useAssistantFirstVisit";

/**
 * The trip assistant for someone who has never opened it: it opens by itself
 * after 2.5 s, its trigger pulses and its docked column is kept until it has
 * been opened, and opening it records that in storage and the cookie.
 */

type Props = Parameters<typeof useAssistantFirstVisit>[0];

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    canUseAssistant: true,
    assistantSeen: false,
    isAIAssistantOpen: false,
    setIsAIAssistantOpen: vi.fn(),
    ...over,
  };
  const view = renderHook((p: Props) => useAssistantFirstVisit(p), { initialProps: props });
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { props, view, wait };
}

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  rememberAssistantSeen.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAssistantFirstVisit", () => {
  it("on a first visit keeps the docked column, pulses the trigger, and opens the assistant after 2.5 s", async () => {
    const { props, view, wait } = setup();
    expect(view.result.current).toEqual({ hasSeenAssistant: false, assistantDockReserved: true, openedItself: false });
    await wait(2499);
    expect(props.setIsAIAssistantOpen).not.toHaveBeenCalled();
    await wait(1);
    expect(props.setIsAIAssistantOpen).toHaveBeenCalledWith(true);
    // So the page asks nothing else in this visit.
    expect(view.result.current.openedItself).toBe(true);
  });

  it("records the first opening in storage and the cookie, stops the pulse and lets the column go", () => {
    const { props, view } = setup();
    view.rerender({ ...props, isAIAssistantOpen: true });
    expect(store.has("mt_ai_assistant_seen")).toBe(true);
    expect(rememberAssistantSeen).toHaveBeenCalledTimes(1);
    expect(view.result.current).toEqual({ hasSeenAssistant: true, assistantDockReserved: false, openedItself: false });
  });

  it("leaves a browser with the cookie alone: no column, no pulse, no opening", async () => {
    const { props, view, wait } = setup({ assistantSeen: true });
    expect(view.result.current).toEqual({ hasSeenAssistant: true, assistantDockReserved: false, openedItself: false });
    await wait(5000);
    expect(props.setIsAIAssistantOpen).not.toHaveBeenCalled();
    expect(rememberAssistantSeen).not.toHaveBeenCalled();
  });

  it("gives a browser that met the assistant before the cookie existed the cookie, and lets the column go", async () => {
    store.set("mt_ai_assistant_seen", "1");
    const { props, view, wait } = setup();
    expect(rememberAssistantSeen).toHaveBeenCalledTimes(1);
    expect(view.result.current).toEqual({ hasSeenAssistant: true, assistantDockReserved: false, openedItself: false });
    await wait(5000);
    expect(props.setIsAIAssistantOpen).not.toHaveBeenCalled();
  });

  it("does nothing for someone who cannot use the assistant", async () => {
    const { props, view, wait } = setup({ canUseAssistant: false });
    expect(view.result.current).toEqual({ hasSeenAssistant: true, assistantDockReserved: false, openedItself: false });
    await wait(5000);
    expect(props.setIsAIAssistantOpen).not.toHaveBeenCalled();
    expect(rememberAssistantSeen).not.toHaveBeenCalled();
  });

  it("does not open the assistant after the planner has left the page", async () => {
    const { props, view, wait } = setup();
    await wait(1000);
    view.unmount();
    await wait(5000);
    expect(props.setIsAIAssistantOpen).not.toHaveBeenCalled();
  });
});
