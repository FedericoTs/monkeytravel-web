/** @vitest-environment node */
/**
 * The save_box_benefits experiment's wiring in the planner (the box's two versions are tested in
 * components/ui/AuthPromptModal): the arm is drawn once per browser with its link and switch, recorded when the box
 * opens for keeping a plan (every way in goes through openKeepAuth), and both of the planner's boxes show that arm.
 * Asserted against the source: the planner is too big to render for one branch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SAVE_BOX_BENEFITS, experimentByKey } from "@/lib/experiments/registry";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");
const openAt = SRC.indexOf("const openKeepAuth = (location: AuthPromptLocation) => {");
const openKeepAuth = SRC.slice(openAt, SRC.indexOf("\n  };", openAt));

describe("the save box's words, by the experiment's arm", () => {
  it("draws the arm with its link and its switch", () => {
    expect(SRC).toMatch(/assignArm\(SAVE_BOX_BENEFITS, \{\s*asked: searchParams\?\.get\("exp_save_box_benefits"\),/);
    expect(SRC).toContain("pin: process.env.NEXT_PUBLIC_EXP_SAVE_BOX_BENEFITS,");
  });

  it("records a counted browser's arm when the box opens to keep a plan", () => {
    expect(openAt).toBeGreaterThan(-1);
    expect(openKeepAuth).toContain('setAuthPromptReason("save");');
    expect(openKeepAuth).toContain("reportExposure(SAVE_BOX_BENEFITS, saveBoxTest);");
  });

  it("shows the arm in both of the planner's boxes", () => {
    expect(SRC.split('saveBenefits={saveBoxTest.arm === "benefits"}').length - 1).toBe(2);
  });

  it("starts its draw only after the sky test's verdict, which reads the same plan screen until 28 November", () => {
    expect(SAVE_BOX_BENEFITS.starts).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 29));
  });

  it("is an experiment the exposure route accepts", () => {
    expect(experimentByKey("save_box_benefits")).toBe(SAVE_BOX_BENEFITS);
  });
});
