import { describe, it, expect, beforeEach } from "vitest";
import {
  claimTripCreatedEmit,
  __resetTripCreatedDedupForTests,
} from "./tripCreatedDedup";

describe("claimTripCreatedEmit", () => {
  beforeEach(() => {
    __resetTripCreatedDedupForTests();
    try {
      window.sessionStorage.clear();
    } catch {
      /* no-op */
    }
  });

  it("emits once and suppresses repeats for the same trip id (the 3x -> 1x fix)", () => {
    // Reproduces the real session: three save runs for one trip id.
    expect(claimTripCreatedEmit("trip-abc")).toBe(true); // run 1 -> emit
    expect(claimTripCreatedEmit("trip-abc")).toBe(false); // run 2 (reused row) -> skip
    expect(claimTripCreatedEmit("trip-abc")).toBe(false); // run 3 (manual re-click) -> skip
  });

  it("emits once per distinct trip id", () => {
    expect(claimTripCreatedEmit("trip-1")).toBe(true);
    expect(claimTripCreatedEmit("trip-2")).toBe(true);
    expect(claimTripCreatedEmit("trip-1")).toBe(false);
    expect(claimTripCreatedEmit("trip-2")).toBe(false);
  });

  it("survives a remount that clears in-memory state (sessionStorage durability)", () => {
    expect(claimTripCreatedEmit("trip-reload")).toBe(true);
    // Simulate a remount/reload: module memory is gone, sessionStorage persists.
    __resetTripCreatedDedupForTests();
    expect(claimTripCreatedEmit("trip-reload")).toBe(false);
  });

  it("fails open on a missing trip id so it never suppresses a real activation", () => {
    expect(claimTripCreatedEmit("")).toBe(true);
    expect(claimTripCreatedEmit(null)).toBe(true);
    expect(claimTripCreatedEmit(undefined)).toBe(true);
  });
});
