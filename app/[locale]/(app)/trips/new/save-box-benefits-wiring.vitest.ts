/** @vitest-environment node */
/**
 * The save_box_benefits experiment's wiring in the planner (the box's two versions are tested in
 * components/ui/AuthPromptModal, the card in components/wizard/SaveBenefitsCard): the arm is drawn once per browser
 * with its link and switch, recorded from the plan a signed-out planner sees (and again, a repeat the page drops, when
 * the box opens for keeping a plan), the benefits arm's card sits at the end of an unsaved plan, and both of the
 * planner's boxes show the arm. Asserted against the source: the planner is too big to render for one branch.
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

  it("records a counted browser's arm from the plan a signed-out planner sees, where the arms first differ", () => {
    expect(SRC).toContain("if (hasResult && isAuthenticated === false) reportExposure(SAVE_BOX_BENEFITS, saveBoxTest);");
  });

  it("puts the benefits arm's card at the end of an unsaved plan for a signed-out planner, saving the way Save does", () => {
    const at = SRC.indexOf("<SaveBenefitsCard ");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(SRC.lastIndexOf("{", at), at)).toContain(
      'saveBoxTest.arm === "benefits" && isAuthenticated === false && isUnsaved && !savedTripId && (',
    );
    expect(SRC).toContain("<SaveBenefitsCard onSave={handleSaveTrip} saving={loading || claimingSharedPlan} />");
    expect(at).toBeLessThan(SRC.indexOf('<AiDisclaimer title={t("wizard.result.aiVerifiedTitle")}'));
  });

  it("records a counted browser's arm when the box opens to keep a plan", () => {
    expect(openAt).toBeGreaterThan(-1);
    expect(openKeepAuth).toContain('setAuthPromptReason("save");');
    expect(openKeepAuth).toContain("reportExposure(SAVE_BOX_BENEFITS, saveBoxTest);");
  });

  it("shows the arm in both of the planner's boxes", () => {
    expect(SRC.split('saveBenefits={saveBoxTest.arm === "benefits"}').length - 1).toBe(2);
  });

  it("draws on its own while the sky test still reads the same plan screen, so each arm of one meets both of the other", () => {
    expect(SAVE_BOX_BENEFITS.starts).toBe(Date.UTC(2026, 10, 26, 20, 0));
    const draw = SRC.slice(SRC.indexOf("return assignArm(SAVE_BOX_BENEFITS, {"));
    expect(draw.slice(0, draw.indexOf("});"))).toContain("random: Math.random,");
  });

  it("is an experiment the exposure route accepts", () => {
    expect(experimentByKey("save_box_benefits")).toBe(SAVE_BOX_BENEFITS);
  });
});
