/** @vitest-environment node */
/**
 * The phone_plan_rows experiment's wiring in the planner (the rows are tested in components/trip/StopRow and
 * components/wizard/ResultItinerary.phone): the arm is drawn once per browser with its link and switch, counted
 * from a plan on a phone's screen, and the rows arm changes only a phone's classic plan: the day list, where the
 * assistant sits and how it looks, and the closing note's words. Asserted against the source: the planner is too
 * big to render for one branch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PHONE_PLAN_ROWS, experimentByKey } from "@/lib/experiments/registry";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");
const WORKFLOWS = ["e2e-public.yml", "e2e-signed-in.yml"].map((file) =>
  readFileSync(join(__dirname, "../../../../../.github/workflows", file), "utf8"),
);

describe("a phone's plan, by the experiment's arm", () => {
  it("draws the arm with its link and its switch, at random", () => {
    expect(SRC).toMatch(/assignArm\(PHONE_PLAN_ROWS, \{\s*asked: searchParams\?\.get\("exp_phone_plan_rows"\),/);
    expect(SRC).toContain("pin: process.env.NEXT_PUBLIC_EXP_PHONE_PLAN_ROWS,");
    const draw = SRC.slice(SRC.indexOf("return assignArm(PHONE_PLAN_ROWS, {"));
    expect(draw.slice(0, draw.indexOf("});"))).toContain("random: Math.random,");
  });

  it("shows the control before the browser is known", () => {
    const at = SRC.indexOf("useState<Assignment<(typeof PHONE_PLAN_ROWS.arms)[number]>>");
    expect(SRC.slice(at, at + 260)).toContain('if (typeof window === "undefined") return { arm: "cards", counted: false };');
  });

  it("counts a browser from a plan on a phone's screen, where the arms first differ", () => {
    expect(SRC).toContain("const isPhone = useIsPhone();");
    expect(SRC).toContain("if (hasResult && phoneRowsOffered) reportExposure(PHONE_PLAN_ROWS, phonePlanTest);");
  });

  it("gives the rows to a phone in the rows arm only", () => {
    expect(SRC).toContain('const phoneRows = phoneRowsOffered && phonePlanTest.arm === "rows";');
    expect(SRC).toContain("phoneRows={phoneRows}");
  });

  it("moves the assistant under the first day in its short look, and nowhere else", () => {
    expect(SRC.split("<AssistantPanelView").length - 1).toBe(1);
    expect(SRC).toContain("compact={phoneRows}");
    expect(SRC).toContain('{!phoneRows && <div className="mb-8">{assistantPanel}</div>}');
    expect(SRC).toContain("afterFirstDay={phoneRows ? <div>{assistantPanel}</div> : undefined}");
  });

  it("leaves the header's tags out above the row of days, which are pills to tap", () => {
    expect(SRC).toContain("tags={phoneRows ? undefined : generatedItinerary.destination.best_for}");
  });

  it("tells a reader of rows to tap a stop, not to press a button the rows don't have", () => {
    expect(SRC).toContain('{phoneRows ? t("wizard.result.aiVerifiedBodyRows") : t("wizard.result.aiVerifiedBody")}');
  });

  it("is an experiment the exposure route accepts, with the cards as its control", () => {
    expect(experimentByKey("phone_plan_rows")).toBe(PHONE_PLAN_ROWS);
    expect(PHONE_PLAN_ROWS.arms[0]).toBe("cards");
  });

  it("is switched off in the browser tests, which ask for an arm with its link", () => {
    for (const workflow of WORKFLOWS) expect(workflow).toContain('NEXT_PUBLIC_EXP_PHONE_PLAN_ROWS: "off"');
  });
});
