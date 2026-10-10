/** @vitest-environment jsdom */
/**
 * A removal waits behind a toast with Undo before it is sent, so a wrong tap
 * costs nothing. What is still waiting when the panel closes or the page is
 * left is sent then, so a removal is never lost either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { UNDO_WINDOW_MS, useUndoableRemoval, type SendRemoval } from "./useUndoableRemoval";

const labels = { removed: "Expense removed.", undo: "Undo" };
const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;
const setup = (send: SendRemoval) => renderHook(() => useUndoableRemoval(send, labels), { wrapper });
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useUndoableRemoval", () => {
  it("hides the row at once and sends the removal only once Undo has gone", async () => {
    const send = vi.fn<SendRemoval>(async () => true);
    const { result } = setup(send);
    act(() => result.current.remove("exp-1"));
    expect(result.current.hidden.has("exp-1")).toBe(true);
    expect(screen.getByText("Expense removed.")).toBeTruthy();

    await wait(UNDO_WINDOW_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await wait(1);
    expect(send).toHaveBeenCalledExactlyOnceWith("exp-1", { keepalive: false });
    // Gone for good: a list read before the removal can't bring it back.
    expect(result.current.hidden.has("exp-1")).toBe(true);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("brings the row back and sends nothing on Undo", async () => {
    const send = vi.fn<SendRemoval>(async () => true);
    const { result } = setup(send);
    act(() => result.current.remove("exp-1"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(result.current.hidden.has("exp-1")).toBe(false);
    await wait(UNDO_WINDOW_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the row again when the removal doesn't go through", async () => {
    const send = vi.fn<SendRemoval>(async () => false);
    const { result } = setup(send);
    act(() => result.current.remove("exp-1"));
    await wait(UNDO_WINDOW_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.hidden.has("exp-1")).toBe(false);
  });

  it("sends removals one at a time", async () => {
    let finishFirst: (sent: boolean) => void = () => undefined;
    const send = vi.fn<SendRemoval>((id) => (id === "exp-1" ? new Promise<boolean>((resolve) => (finishFirst = resolve)) : Promise.resolve(true)));
    const { result } = setup(send);
    act(() => result.current.remove("exp-1"));
    act(() => result.current.remove("exp-2"));
    await wait(UNDO_WINDOW_MS);
    expect(send.mock.calls.map(([id]) => id)).toEqual(["exp-1"]);
    await act(async () => finishFirst(true));
    expect(send.mock.calls.map(([id]) => id)).toEqual(["exp-1", "exp-2"]);
  });

  it("sends what is waiting when the page is left, and only once", async () => {
    const send = vi.fn<SendRemoval>(async () => true);
    const { result } = setup(send);
    act(() => result.current.remove("exp-1"));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(send).toHaveBeenCalledExactlyOnceWith("exp-1", { keepalive: true });
    await wait(UNDO_WINDOW_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends what is waiting when the panel closes, and takes its Undo away", () => {
    const send = vi.fn<SendRemoval>(async () => true);
    function Panel() {
      const { hidden, remove } = useUndoableRemoval(send, labels);
      return <button onClick={() => remove("exp-1")}>{hidden.has("exp-1") ? "Removed" : "Remove"}</button>;
    }
    // The toasts outlive the panel, as on the trip page.
    const page = (open: boolean) => <ToastProvider>{open && <Panel />}</ToastProvider>;
    const { rerender } = render(page(true));
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();

    rerender(page(false));
    expect(send).toHaveBeenCalledExactlyOnceWith("exp-1", { keepalive: true });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
