/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { GenerationReport } from "@/lib/wizard/generation-reports";

const left = vi.hoisted(() => vi.fn());
vi.mock("@/lib/wizard/generation-reports", () => ({ reportGenerationLeft: left }));

import { useGenerationLeft } from "./useGenerationLeft";

/**
 * A generation whose page is hidden, closed or left for another page before
 * the plan comes back gets the funnel's row, once per generation; so a visitor
 * who walked away is told apart from a generation that never answered.
 */

const generation = (destination: string) => ({ destination, startedAt: Date.now() }) as GenerationReport;

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => left.mockClear());
afterEach(() => setVisibility("visible"));

describe("useGenerationLeft", () => {
  it("reports a generation whose page is hidden mid-wait, once however often it is hidden", () => {
    const inFlight = { current: generation("Lisbon") };
    renderHook(() => useGenerationLeft(inFlight));

    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));

    expect(left).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledWith(inFlight.current);
  });

  it("reports a closed page", () => {
    const inFlight = { current: generation("Lisbon") };
    renderHook(() => useGenerationLeft(inFlight));
    window.dispatchEvent(new Event("pagehide"));
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("reports nothing between generations, nor for a page coming back into view", () => {
    const inFlight: { current: GenerationReport | null } = { current: null };
    renderHook(() => useGenerationLeft(inFlight));

    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    inFlight.current = generation("Lisbon");
    setVisibility("visible");

    expect(left).not.toHaveBeenCalled();
  });

  it("reports each generation left on its own", () => {
    const first = generation("Lisbon");
    const second = generation("Porto");
    const inFlight: { current: GenerationReport | null } = { current: first };
    renderHook(() => useGenerationLeft(inFlight));

    setVisibility("hidden");
    setVisibility("visible");
    inFlight.current = second;
    setVisibility("hidden");

    expect(left.mock.calls.map(([g]) => g)).toEqual([first, second]);
  });

  it("reports a wizard left for another page mid-wait, and not one left between generations", () => {
    const inFlight: { current: GenerationReport | null } = { current: generation("Lisbon") };
    renderHook(() => useGenerationLeft(inFlight)).unmount();
    expect(left).toHaveBeenCalledTimes(1);

    inFlight.current = null;
    renderHook(() => useGenerationLeft(inFlight)).unmount();
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the wizard is gone", () => {
    const inFlight = { current: generation("Lisbon") };
    const { unmount } = renderHook(() => useGenerationLeft(inFlight));
    unmount();
    left.mockClear();
    inFlight.current = generation("Porto");
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    expect(left).not.toHaveBeenCalled();
  });
});
