/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { decideDraftRestore, type DraftRestoreInput } from "./draft-restore";

const base: DraftRestoreInput = {
  hasDraft: true,
  hasItineraryInDraft: true,
  alreadyRestored: false,
  itineraryOnScreen: false,
  isAuthenticated: false,
  savedTripId: null,
  pendingTripGeneration: false,
};
const decide = (over: Partial<DraftRestoreInput> = {}) => decideDraftRestore({ ...base, ...over });

describe("the tri-state auth trap (the bug this function exists for)", () => {
  it("waits while auth is unresolved — it must NOT offer the banner", () => {
    expect(decide({ isAuthenticated: null })).toBe("wait");
    expect(decide({ isAuthenticated: null, pendingTripGeneration: true })).toBe("wait");
    expect(decide({ isAuthenticated: null, hasItineraryInDraft: false })).toBe("wait");
  });

  it("resolves to auto-restore once auth turns out to be signed in", () => {
    expect(decide({ isAuthenticated: null })).toBe("wait");
    expect(decide({ isAuthenticated: true })).toBe("auto-restore");
  });
});

describe("every path back into an account restores, not just the Save modal", () => {
  it("auto-restores for a signed-in visitor with no pendingTripGeneration flag", () => {
    // The header Sign-in / login-page / magic-link path: the flag is only ever
    // written by AuthPromptModal, and these users never touched it.
    expect(decide({ isAuthenticated: true, pendingTripGeneration: false })).toBe("auto-restore");
  });

  it("still auto-restores on the Save-modal path, even for a form-only draft", () => {
    expect(decide({ pendingTripGeneration: true, isAuthenticated: true })).toBe("auto-restore");
    expect(decide({ pendingTripGeneration: true, hasItineraryInDraft: false })).toBe("auto-restore");
  });

  it("offers the banner to a signed-out visitor rather than restoring silently", () => {
    expect(decide({ isAuthenticated: false })).toBe("offer-banner");
  });
});

describe("a spent or absent draft is left alone", () => {
  it("never resurrects a draft once the trip is saved", () => {
    expect(decide({ isAuthenticated: true, savedTripId: "trip-1" })).toBe("idle");
  });

  it("never overwrites an itinerary already on screen", () => {
    expect(decide({ itineraryOnScreen: true, isAuthenticated: true })).toBe("idle");
    expect(decide({ itineraryOnScreen: true, isAuthenticated: null })).toBe("idle");
  });

  it("does nothing when there is no draft, or it was already restored", () => {
    expect(decide({ hasDraft: false })).toBe("idle");
    expect(decide({ hasDraft: false, isAuthenticated: null })).toBe("idle");
    expect(decide({ alreadyRestored: true, isAuthenticated: true })).toBe("idle");
  });

  it("does not put a form-only draft on screen for a signed-in user", () => {
    expect(decide({ hasItineraryInDraft: false, isAuthenticated: true })).toBe("idle");
    expect(decide({ hasItineraryInDraft: false, isAuthenticated: false })).toBe("offer-banner");
  });
});

describe("exhaustive: no state can produce a banner while auth is unknown", () => {
  it("holds across every combination", () => {
    const bools = [true, false];
    for (const hasDraft of bools)
      for (const hasItineraryInDraft of bools)
        for (const alreadyRestored of bools)
          for (const itineraryOnScreen of bools)
            for (const pendingTripGeneration of bools)
              for (const savedTripId of [null, "t1"]) {
                const d = decideDraftRestore({
                  hasDraft, hasItineraryInDraft, alreadyRestored, itineraryOnScreen,
                  pendingTripGeneration, savedTripId, isAuthenticated: null,
                });
                expect(d, JSON.stringify({ hasDraft, alreadyRestored, itineraryOnScreen })).not.toBe("offer-banner");
                expect(["wait", "idle"]).toContain(d);
              }
  });
});
