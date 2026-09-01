/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  shouldAutoSave,
  shouldRedeemSaveIntent,
  type FlagState,
} from "./autoSaveGate";

/**
 * The bug these tests exist for:
 *
 * A signed-in user generated an itinerary, the generation SUCCEEDED (their
 * quota was decremented), and no trip was ever written. 30 users, 44 burned
 * generations, zero trips - because the flag was unresolved and BOTH
 * persistence paths declined to act.
 */

const STATES: FlagState[] = [true, false, undefined];

describe("exactly one path owns persistence", () => {
  it.each(STATES)("flag=%s has exactly one owner", (flag) => {
    const owners = [shouldAutoSave(flag), shouldRedeemSaveIntent(flag)].filter(
      Boolean
    ).length;
    expect(owners).toBe(1);
  });

  it("no state is left ownerless - the defect that lost 44 generations", () => {
    for (const flag of STATES) {
      expect(shouldAutoSave(flag) || shouldRedeemSaveIntent(flag)).toBe(true);
    }
  });

  it("no state is owned twice, which would duplicate the trip", () => {
    for (const flag of STATES) {
      expect(shouldAutoSave(flag) && shouldRedeemSaveIntent(flag)).toBe(false);
    }
  });
});

describe("unresolved flag - the cohort that was losing trips", () => {
  it("auto-saves when PostHog never resolves the flag", () => {
    // Analytics consent declined, ad blocker, or a failed PostHog request.
    // This is permanent for that visitor, not a loading state.
    expect(shouldAutoSave(undefined)).toBe(true);
  });

  it("does NOT also run the redemption path, so the trip is saved once", () => {
    expect(shouldRedeemSaveIntent(undefined)).toBe(false);
  });
});

describe("the kill-switch still works", () => {
  it("a RESOLVED false disables auto-save", () => {
    // Flipping auto-save-v1 to 0% must still roll the feature back with no
    // redeploy - that was the whole point of gating it.
    expect(shouldAutoSave(false)).toBe(false);
  });

  it("and hands the post-auth save intent to the redemption effect", () => {
    expect(shouldRedeemSaveIntent(false)).toBe(true);
  });
});

describe("the fully rolled-out case is unchanged", () => {
  it("flag true auto-saves", () => {
    expect(shouldAutoSave(true)).toBe(true);
  });

  it("flag true does not redeem, avoiding a double save", () => {
    expect(shouldRedeemSaveIntent(true)).toBe(false);
  });
});
