/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { onNavigationStart, startNavigationCue } from "./navigation-cue";

const stops: Array<() => void> = [];
const listen = () => {
  const heard = vi.fn();
  stops.push(onNavigationStart(heard));
  return heard;
};
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  window.history.replaceState(null, "", "/");
});

describe("the navigation cue's signal", () => {
  it("reaches everyone listening when a page is opened", () => {
    const first = listen();
    const second = listen();
    startNavigationCue("/trips/1");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("starts without a known target too", () => {
    const heard = listen();
    startNavigationCue(null);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for the page already shown, or a jump within it", () => {
    window.history.replaceState(null, "", "/en/trips/1?day=2");
    const heard = listen();
    startNavigationCue("/en/trips/1?day=2");
    startNavigationCue(window.location.origin + "/en/trips/1?day=2#day-3");
    expect(heard).not.toHaveBeenCalled();
    startNavigationCue("/en/trips/1?day=3");
    startNavigationCue("/en/trips/2?day=2");
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("stops reaching a listener that has left", () => {
    const heard = vi.fn();
    const stop = onNavigationStart(heard);
    stop();
    startNavigationCue("/trips/1");
    expect(heard).not.toHaveBeenCalled();
  });
});
