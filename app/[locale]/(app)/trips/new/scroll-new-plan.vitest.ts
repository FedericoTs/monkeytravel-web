/** @vitest-environment node */
/**
 * The plan screen goes to the top for a new plan only (hooks/useScrollTopOnNewPlan.vitest.ts), not each time the
 * same plan's object is replaced by its photos or an assistant's edit. Asserted against the source: the planner is
 * too big to render for one effect.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8");

describe("the plan screen keeps the reader's place", () => {
  it("goes to the top through the hook that tells a new plan from the same plan changing", () => {
    expect(SRC).toContain("useScrollTopOnNewPlan(generatedItinerary, planNumber);");
    // No effect that scrolls whenever the plan object changes.
    expect(SRC).not.toMatch(/scrollTo\([^)]*\);?\s*\}?\s*\},\s*\[generatedItinerary\]\)/);
  });
});
