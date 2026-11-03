import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const capture = vi.fn();
const exitUnsaved = vi.fn();
let native = false;
vi.mock("@/lib/posthog/events", () => ({
  capture: (...a: unknown[]) => capture(...a),
  captureResultExitUnsaved: (...a: unknown[]) => exitUnsaved(...a),
}));
vi.mock("@/lib/native/platform", () => ({ isNativePlatform: () => native }));

import { useUnsavedPlan } from "./useUnsavedPlan";

type Props = Parameters<typeof useUnsavedPlan>[0];
const props = (over: Partial<Props> = {}): Props => ({
  hasResult: true,
  isUnsaved: true,
  sessionTrayVisible: false,
  showAuthModal: false,
  getGenCount: () => 2,
  ...over,
});
const nudges = (source: string) => capture.mock.calls.filter(([name, p]) => name === "save_nudge_shown" && p.source === source);
const leave = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const pageshow = (persisted: boolean) => {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
};

beforeEach(() => {
  sessionStorage.clear();
  native = false;
  capture.mockClear();
  exitUnsaved.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("useUnsavedPlan", () => {
  it("counts the pill's nudge once per session, and the tray's when it shows", () => {
    const { rerender, unmount } = renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props() });
    rerender(props({ sessionTrayVisible: true }));
    unmount();
    renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props({ sessionTrayVisible: true }) });
    expect(nudges("unsaved_pill")).toEqual([["save_nudge_shown", { source: "unsaved_pill", gen_count: 2 }]]);
    expect(nudges("session_tray")).toEqual([["save_nudge_shown", { source: "session_tray", gen_count: 2 }]]);
  });

  it("stays quiet when storage is blocked, since it could not count once", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props({ sessionTrayVisible: true }) });
    expect(capture).not.toHaveBeenCalled();
  });

  it("asks before leaving an unsaved plan, and not once it is saved or while the account dialog is open", () => {
    const { rerender } = renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props() });
    expect(leave()).toBe(true);
    rerender(props({ showAuthModal: true }));
    expect(leave()).toBe(false);
    rerender(props({ isUnsaved: false }));
    expect(leave()).toBe(false);
  });

  it("does not ask inside the native app", () => {
    native = true;
    renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props() });
    expect(leave()).toBe(false);
  });

  it("records leaving an unsaved plan once per departure, with the assistant's edits", () => {
    const { result } = renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props() });
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    act(() => result.current.noteEditApplied());
    pageshow(true);
    window.dispatchEvent(new Event("pagehide"));
    expect(exitUnsaved.mock.calls).toEqual([[{ gen_count: 2, edits_applied: false }], [{ gen_count: 2, edits_applied: true }]]);
    expect(sessionStorage.getItem("mt_edits_applied")).toBe("1");
  });

  it("takes an edit applied before a sign-in round trip from the session's mirror", () => {
    sessionStorage.setItem("mt_edits_applied", "1");
    renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props() });
    window.dispatchEvent(new Event("pagehide"));
    expect(exitUnsaved).toHaveBeenCalledWith({ gen_count: 2, edits_applied: true });
  });

  it("records nothing for a saved plan", () => {
    renderHook((p: Props) => useUnsavedPlan(p), { initialProps: props({ isUnsaved: false }) });
    window.dispatchEvent(new Event("pagehide"));
    expect(exitUnsaved).not.toHaveBeenCalled();
    expect(nudges("unsaved_pill")).toEqual([]);
  });
});
