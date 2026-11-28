/** @vitest-environment node */
/**
 * Where the plan screen says what was checked for the trip's dates (components/trip/PlanChecksNote, the counts from
 * lib/ai/plan-checks): once, from the plan's own counts, at the top of the plan in every layout, before the
 * assistant and the days. Asserted against the source: the planner is too big to render for one line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");
const NOTE = '<PlanChecksNote checked={generatedItinerary.checked} className="mb-6" />';

describe("what was checked, on the plan screen", () => {
  it("is said once, from the counts the plan carries", () => {
    expect(SRC.split("<PlanChecksNote").length - 1).toBe(1);
    expect(SRC).toContain(NOTE);
  });

  it("comes first in the plan's column: before the assistant and before the days", () => {
    const main = SRC.indexOf('<main className="max-w-6xl mx-auto px-4 py-8">');
    const note = SRC.indexOf(NOTE);
    expect(main).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(main);
    expect(note).toBeLessThan(SRC.indexOf('{!phoneRows && <div className="mb-8">{assistantPanel}</div>}'));
    expect(note).toBeLessThan(SRC.indexOf("<ResultItinerary"));
  });

  it("is on every layout: no arm of a test and no screen size leaves it out", () => {
    const line = SRC.split("\n").find((l) => l.includes(NOTE))!;
    expect(line.trim()).toBe(NOTE);
    const before = SRC.slice(0, SRC.indexOf(NOTE)).trimEnd();
    // The line right above is its comment, not a condition that would hide it.
    expect(before.endsWith("*/}")).toBe(true);
  });

  it("keeps the note honest when the browser changes the plan", () => {
    const hook = readFileSync(join(__dirname, "../../../../../hooks/useGeneratedPlan.ts"), "utf8");
    expect(hook).toContain("withHonestChecks(prev, value)");
    expect(SRC).toContain("const [generatedItinerary, setGeneratedItinerary] = useGeneratedPlan();");
  });
});
