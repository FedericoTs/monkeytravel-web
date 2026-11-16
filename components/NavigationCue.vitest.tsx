/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { startNavigationCue } from "@/lib/navigation-cue";
import NavigationCue from "./NavigationCue";

const address = vi.hoisted(() => ({ pathname: "/en/trips", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => address.pathname,
  useSearchParams: () => new URLSearchParams(address.search),
}));

const bar = () => screen.queryByTestId("navigation-cue");

beforeEach(() => {
  address.pathname = "/en/trips";
  address.search = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the bar that follows a tap to another page", () => {
  it("is not there until a page is opened", () => {
    render(<NavigationCue />);
    expect(bar()).toBeNull();
  });

  it("shows as the navigation starts, hidden from screen readers", () => {
    render(<NavigationCue />);
    act(() => startNavigationCue(null));
    expect(bar()).not.toBeNull();
    expect(bar()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("goes when the address changes, by path or by query", () => {
    const { rerender } = render(<NavigationCue />);
    act(() => startNavigationCue(null));
    address.pathname = "/en/trips/1";
    rerender(<NavigationCue />);
    expect(bar()).toBeNull();

    act(() => startNavigationCue(null));
    expect(bar()).not.toBeNull();
    address.search = "day=2";
    rerender(<NavigationCue />);
    expect(bar()).toBeNull();
  });

  it("stays while the address hasn't changed", () => {
    const { rerender } = render(<NavigationCue />);
    act(() => startNavigationCue(null));
    rerender(<NavigationCue />);
    expect(bar()).not.toBeNull();
  });

  it("gives up after ten seconds", () => {
    vi.useFakeTimers();
    render(<NavigationCue />);
    act(() => startNavigationCue(null));
    act(() => vi.advanceTimersByTime(9_900));
    expect(bar()).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(bar()).toBeNull();
  });

  it("stops listening once gone", () => {
    const { unmount } = render(<NavigationCue />);
    unmount();
    expect(() => act(() => startNavigationCue(null))).not.toThrow();
  });
});
