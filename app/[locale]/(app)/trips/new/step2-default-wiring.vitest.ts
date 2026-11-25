/** @vitest-environment node */
/**
 * The step2_default experiment's wiring in the planner (the pieces are tested in lib/experiments and
 * lib/wizard/step2-default): the arm is drawn once per browser with its link and switch; leaving step 1 with no vibe
 * picked records a counted browser's arm and seeds step 2 by arm; the data arm's taps add to the suggestion.
 * Asserted against the source: the planner is too big to render for one branch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");
const continueAt = SRC.indexOf("const handleContinue = () => {");
const handleContinue = SRC.slice(continueAt, SRC.indexOf("setStep(step + 1);", continueAt));

describe("step 2's starting vibes, by the experiment's arm", () => {
  it("draws the arm with its link and its switch", () => {
    expect(SRC).toMatch(/assignArm\(STEP2_DEFAULT, \{\s*asked: searchParams\?\.get\("exp_step2_default"\),/);
    expect(SRC).toContain("pin: process.env.NEXT_PUBLIC_EXP_STEP2_DEFAULT,");
  });

  it("records the arm and seeds step 2 only when no vibe is picked yet", () => {
    expect(continueAt).toBeGreaterThan(-1);
    expect(handleContinue).toMatch(/if \(step === 1 && selectedVibes\.length === 0\) \{\s*reportExposure\(STEP2_DEFAULT, step2Test\);/);
  });

  it("seeds the data arm with the two most chosen styles for the kind of place and company, and the other with the season's", () => {
    expect(handleContinue).toMatch(
      /if \(step2Test\.arm === "data"\) \{\s*setSelectedVibes\(step2Default\(tripIntent, placeKind\(destination, MULTI_CITY_ENABLED && multiCityMode\)\)\);\s*setVibesSuggested\(true\);/,
    );
    expect(handleContinue).toContain("seasonalVibeSeed(seasonalContext, startDate, tripIntent)");
  });

  it("lets the data arm's taps add to the suggestion", () => {
    expect(SRC).toContain('vibesAddToSuggestion={step2Test.arm === "data"}');
  });
});
