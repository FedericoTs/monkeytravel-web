import { afterEach, describe, expect, it } from "vitest";
import { isNativePlatform } from "./platform";

/** isNativePlatform reads the `Capacitor` global the native shell injects. */
type WithCapacitor = { Capacitor?: { isNativePlatform?: () => boolean } };

afterEach(() => {
  delete (window as unknown as WithCapacitor).Capacitor;
});

describe("isNativePlatform", () => {
  it("is false in a plain browser, where there is no Capacitor global", () => {
    expect(isNativePlatform()).toBe(false);
  });

  it("is true when the shell's Capacitor says it is native", () => {
    (window as unknown as WithCapacitor).Capacitor = { isNativePlatform: () => true };
    expect(isNativePlatform()).toBe(true);
  });

  it("is false when Capacitor is present but runs on the web", () => {
    (window as unknown as WithCapacitor).Capacitor = { isNativePlatform: () => false };
    expect(isNativePlatform()).toBe(false);
  });

  it("is false when Capacitor lacks the method", () => {
    (window as unknown as WithCapacitor).Capacitor = {};
    expect(isNativePlatform()).toBe(false);
  });
});
