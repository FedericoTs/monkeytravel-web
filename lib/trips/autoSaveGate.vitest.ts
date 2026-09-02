/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  AUTO_SAVE_FORCE_OFF,
  shouldAutoSave,
  shouldRedeemSaveIntent,
  type FlagState,
} from "./autoSaveGate";

/**
 * The two bugs these tests exist for:
 *
 *  1. (fixed 20b5760) An UNRESOLVED PostHog flag satisfied neither
 *     persistence path — 30 users, 44 burned generations, zero trips.
 *
 *  2. (fixed 2026-09-02) A RESOLVED `false` from a stale flag cache in one
 *     browser switched auto-save off for that browser for good. Six signed-in
 *     users in 30 days reached a rendered result and no save was ever
 *     attempted; the browsers that lose trips this way are exactly the ones
 *     PostHog cannot see. The flag no longer decides anything.
 */

const STATES: FlagState[] = [true, false, undefined];
const ENVS: Array<string | undefined> = [undefined, "", "on", AUTO_SAVE_FORCE_OFF];

describe("exactly one path owns persistence, in every state", () => {
  it.each(STATES)("flag=%s has exactly one owner", (flag) => {
    for (const env of ENVS) {
      const owners = [shouldAutoSave(flag, env), shouldRedeemSaveIntent(flag, env)].filter(Boolean).length;
      expect(owners, `flag=${String(flag)} env=${String(env)}`).toBe(1);
    }
  });
});

describe("the flag is ignored — a stale cached false cannot switch saving off", () => {
  it.each(STATES)("flag=%s auto-saves", (flag) => {
    expect(shouldAutoSave(flag)).toBe(true);
    expect(shouldRedeemSaveIntent(flag)).toBe(false);
  });

  it("a RESOLVED false in particular still auto-saves (regression 2026-09-02)", () => {
    expect(shouldAutoSave(false)).toBe(true);
  });

  it("an unresolved flag still auto-saves (regression 20b5760)", () => {
    expect(shouldAutoSave(undefined)).toBe(true);
  });
});

describe("the kill switch is the environment, not a client-side flag read", () => {
  it("NEXT_PUBLIC_AUTO_SAVE_FORCE=off disables auto-save regardless of the flag", () => {
    for (const flag of STATES) expect(shouldAutoSave(flag, AUTO_SAVE_FORCE_OFF)).toBe(false);
  });

  it("…and hands the post-auth save intent to the redemption effect, once", () => {
    for (const flag of STATES) expect(shouldRedeemSaveIntent(flag, AUTO_SAVE_FORCE_OFF)).toBe(true);
  });

  it("any other value, empty, or unset leaves auto-save on", () => {
    for (const env of ["", "on", "true", "0", undefined, null]) {
      expect(shouldAutoSave(true, env)).toBe(true);
      expect(shouldRedeemSaveIntent(true, env)).toBe(false);
    }
  });
});
