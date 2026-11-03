import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";

/**
 * The share prompt closes after its exit animation: onClose once the
 * animation has played, once however many times it is asked, and never after
 * the prompt was removed. A timer left running then would call into a page
 * that has moved on (and, in a test, into an environment already torn down),
 * so a copied link's "Copied" reset goes with the prompt too.
 */

vi.mock("@/lib/analytics", () => ({ trackSharePromptShown: vi.fn(), trackSharePromptAction: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({
  captureSharePromptShown: vi.fn(),
  captureSharePromptAction: vi.fn(),
  captureShareLinkCopied: vi.fn(),
}));

import ShareAfterSaveModal from "./ShareAfterSaveModal";

function renderPrompt() {
  const onClose = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <ShareAfterSaveModal
        isOpen
        onClose={onClose}
        onInvite={vi.fn()}
        tripId="trip-1"
        tripTitle="Lisbon Trip"
        tripDays={4}
        destination="Lisbon"
      />
    </NextIntlClientProvider>
  );
  return { ...view, onClose };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("share prompt, closing", () => {
  it("calls onClose once the exit animation has played", () => {
    vi.useFakeTimers();
    const { onClose } = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Maybe Later" }));
    act(() => vi.advanceTimersByTime(199));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes once when its button is pressed again while the prompt fades out", () => {
    vi.useFakeTimers();
    const { onClose } = renderPrompt();
    const maybeLater = screen.getByRole("button", { name: "Maybe Later" });
    fireEvent.click(maybeLater);
    expect(maybeLater.isConnected, "the panel is still on screen while it fades out").toBe(true);
    fireEvent.click(maybeLater);
    act(() => vi.advanceTimersByTime(1_000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes once when Escape is pressed twice", () => {
    vi.useFakeTimers();
    const { onClose } = renderPrompt();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => vi.advanceTimersByTime(1_000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls nothing back once the prompt is removed", () => {
    vi.useFakeTimers();
    const { onClose, unmount } = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    unmount();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("drops a copied link's reset when the prompt is removed", async () => {
    // Only the timeouts: the animation library keeps frames of its own.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ shareUrl: "https://monkeytravel.app/shared/abc" }) })
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const started = vi.spyOn(globalThis, "setTimeout");
    const { unmount } = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    const reset = started.mock.results[started.mock.calls.findIndex(([, ms]) => ms === 2000)]?.value;
    expect(reset, "copying starts the reset").toBeDefined();
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    unmount();
    expect(cleared).toHaveBeenCalledWith(reset);
  });
});
