/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickResultVariant,
  resetResultArmForTests,
  resultCrewFirstArm,
  RESULT_VARIANT_STORAGE_KEY,
} from "./result-crew-first";

/**
 * Half of the signed-out group planners see the crew-first result screen. The
 * arm is drawn once and kept, a pinned arm (off switch or QA link) is shown
 * but never counted, and a browser without storage keeps one arm per page.
 */

beforeEach(() => {
  resetResultArmForTests();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/trips/new");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pickResultVariant", () => {
  it("splits a fresh browser by the coin, and counts it", () => {
    expect(pickResultVariant({ random: () => 0.2 })).toEqual({ variant: "control", inTest: true });
    expect(pickResultVariant({ random: () => 0.7 })).toEqual({ variant: "crew_first", inTest: true });
  });

  it("keeps a browser's earlier arm", () => {
    expect(pickResultVariant({ stored: "crew_first", random: () => 0.1 })).toEqual({ variant: "crew_first", inTest: true });
  });

  it("shows a pinned arm without counting it, the off switch before the QA link", () => {
    expect(pickResultVariant({ pinned: "control", override: "crew_first", stored: "crew_first", random: () => 0.9 })).toEqual({
      variant: "control",
      inTest: false,
    });
    expect(pickResultVariant({ override: "crew_first", stored: "control", random: () => 0.1 })).toEqual({
      variant: "crew_first",
      inTest: false,
    });
  });

  it("ignores values it does not know", () => {
    expect(pickResultVariant({ pinned: "on", override: "yes", stored: "both", random: () => 0.9 })).toEqual({
      variant: "crew_first",
      inTest: true,
    });
  });
});

describe("resultCrewFirstArm", () => {
  it("draws once, stores it, and answers the same for the rest of the page", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.8);
    expect(resultCrewFirstArm()).toEqual({ variant: "crew_first", inTest: true });
    expect(window.localStorage.getItem(RESULT_VARIANT_STORAGE_KEY)).toBe("crew_first");
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(resultCrewFirstArm().variant).toBe("crew_first");
    resetResultArmForTests();
    expect(resultCrewFirstArm().variant).toBe("crew_first");
  });

  it("keeps one arm for the page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(resultCrewFirstArm().variant).toBe("control");
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    expect(resultCrewFirstArm().variant).toBe("control");
  });

  it("follows the off switch and the QA link, and stores neither", () => {
    vi.stubEnv("NEXT_PUBLIC_RESULT_CREW_FIRST", "control");
    window.history.replaceState(null, "", "/trips/new?result_variant=crew_first");
    expect(resultCrewFirstArm()).toEqual({ variant: "control", inTest: false });
    resetResultArmForTests();
    vi.unstubAllEnvs();
    expect(resultCrewFirstArm()).toEqual({ variant: "crew_first", inTest: false });
    expect(window.localStorage.getItem(RESULT_VARIANT_STORAGE_KEY)).toBeNull();
  });
});
