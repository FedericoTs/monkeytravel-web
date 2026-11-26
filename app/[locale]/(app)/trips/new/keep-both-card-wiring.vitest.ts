/** @vitest-environment node */
/**
 * The keep-both card in the planner (components/wizard/KeepBothCard.tsx, lib/wizard/keep-both.ts): shown above the
 * plan in both of the plan screen's layouts, counted once, its Sign in opening the box that keeps a plan (which marks
 * the visit's places, lib/wizard/visit-trips.ts) under its own name, its sign-ins told apart on the signed-in return
 * and not after the box closes without one. Asserted against the source: the planner is too big to render for one
 * branch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");

describe("the keep-both card in the planner", () => {
  it("shows signed out, on an unsaved plan, when the visit has two or more places", () => {
    expect(SRC).toContain(
      "const visitPlaces = hasResult ? 1 + otherPlacesOfVisit(sessionTrips, { destination, itinerary: generatedItinerary }).length : 0;"
    );
    expect(SRC).toMatch(/keepBothCardShows\(\{\s*signedOut: isAuthenticated === false,\s*planOnScreen: hasResult,\s*unsaved: isUnsaved,\s*places: visitPlaces,\s*dismissed: keepBothTurnedDown,\s*boxOpen: showAuthModal,\s*\}\)/);
  });

  it("sits above the plan in both layouts", () => {
    expect(SRC).toMatch(/\{tripsTray\}\s*\{keepBothCard\}\s*\{errorAlert\}/);
    expect(SRC).toContain("{(tripsTray || keepBothCard || errorAlert) && (");
    expect(SRC).toMatch(/\{!sky && tripsTray\}\s*\{!sky && keepBothCard\}/);
  });

  it("opens the box that keeps a plan under its own name, and is turned down for the visit", () => {
    expect(SRC).toMatch(/onSignIn=\{\(\) => \{\s*markSignInFromCard\(\);\s*openKeepAuth\("wizard_keep_both"\);/);
    expect(SRC).toMatch(/onDismiss=\{\(\) => \{\s*dismissKeepBoth\(\);\s*setKeepBothTurnedDown\(true\);\s*void trackWizardEvent\("keep_both_dismissed"/);
  });

  it("is counted once when shown, and its sign-ins once on the signed-in return, not after the box closes", () => {
    expect(SRC).toContain('if (keepBothShows && firstKeepBothShow()) void trackWizardEvent("keep_both_shown", { destination, locale });');
    expect(SRC).toContain('if (isAuthenticated === true && takeSignInFromCard()) void trackWizardEvent("keep_both_signed_in", { destination, locale });');
    expect(SRC).toMatch(/if \(authPromptReason === "save"\) setSaveBoxClosed\(true\);\s*\/\/ Closed without a sign-in: a later one isn't the card's\.\s*forgetSignInFromCard\(\);/);
  });
});
