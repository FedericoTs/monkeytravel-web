/** @vitest-environment node */
/**
 * The planner's totals. The estimate the model writes never moves after a
 * change, while the day totals and the assistant add up the plan's own stops,
 * so every total the planner shows is that sum, per person, as on the trip
 * page. Asserted against the source: the wizard is too large to render here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n");
const SRC = read("NewTripWizard.tsx");
const SKY = readFileSync(join(__dirname, "../../../../../components/sky/SkyPlan.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("the planner's totals", () => {
  it("add up the plan's stops, per person", () => {
    expect(SRC).toContain("const planTotal = planCosts(generatedItinerary.days);");
    expect(SRC).toContain('const totalCost = planTotal ? `${convertCurrency(planTotal.total, planTotal.currency).formatted} ${tTotal("perPerson")}` : "";');
  });

  it("show that sum in the header, the action bars and the sky's line, never the model's estimate", () => {
    expect(SRC).toContain("budget={planTotal ? { total: planTotal.total, currency: planTotal.currency } : undefined}");
    expect(SRC).toContain('budgetNote={tTotal("perPerson")}');
    expect(SRC.match(/totalCost=\{totalCost\}/g)).toHaveLength(2);
    expect(SRC).not.toMatch(/total_estimated_cost/);
  });

  it("leave the sky's line without a figure when the plan prices nothing", () => {
    expect(SKY).toMatch(/\{totalCost && \(\n\s*<>\n\s*\{", "\}\n\s*\{t\("wizard\.result\.sky\.about", \{ cost: totalCost \}\)\}/);
  });
});
