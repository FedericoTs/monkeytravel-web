/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { AUTO_SAVE_FORCE_OFF, shouldAutoSave, shouldRedeemSaveIntent } from "./autoSaveGate";

/**
 * Exactly one path must own persistence of a signed-in user's trip in every
 * state: when neither did, trips were silently lost.
 */

const ENVS: Array<string | null | undefined> = [undefined, null, "", "on", "true", "0", AUTO_SAVE_FORCE_OFF];

describe("exactly one path owns persistence", () => {
  it.each(ENVS)("env=%s has exactly one owner", (env) => {
    const owners = [shouldAutoSave(env), shouldRedeemSaveIntent(env)].filter(Boolean).length;
    expect(owners).toBe(1);
  });
});

describe("the kill switch", () => {
  it("NEXT_PUBLIC_AUTO_SAVE_FORCE=off disables auto-save and hands the save to the redemption effect", () => {
    expect(shouldAutoSave(AUTO_SAVE_FORCE_OFF)).toBe(false);
    expect(shouldRedeemSaveIntent(AUTO_SAVE_FORCE_OFF)).toBe(true);
  });

  it("any other value, empty, or unset leaves auto-save on", () => {
    for (const env of ["", "on", "true", "0", undefined, null]) {
      expect(shouldAutoSave(env)).toBe(true);
      expect(shouldRedeemSaveIntent(env)).toBe(false);
    }
  });
});
