/** @vitest-environment node */
/**
 * The trip page's total. The estimate saved with the plan never moves after a
 * change, so after a few edits it disagreed with the day totals and with what
 * the assistant quotes. The header adds up the plan's own stops instead, per
 * person, as they stand. Asserted against the source, as the page needs a
 * signed-in session to render (the shared page's view is rendered in
 * app/[locale]/(app)/shared/[token]/read-only.vitest.tsx).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "TripDetailClient.tsx"), "utf8");
const at = SRC.indexOf("<DestinationHero");
const hero = SRC.slice(at, SRC.indexOf("/>", SRC.indexOf("onBack=", at)));

describe("the trip page's total", () => {
  it("adds up the plan as it stands, with every change", () => {
    expect(SRC).toMatch(/const planTotal = useMemo\(\(\) => planCosts\(displayItinerary\), \[displayItinerary\]\);/);
  });

  it("shows that total in the header, per person, and never the estimate saved with the plan", () => {
    expect(at).toBeGreaterThan(-1);
    expect(hero).toMatch(/budget=\{planTotal \? \{ total: planTotal\.total, currency: planTotal\.currency \} : undefined\}/);
    expect(hero).toMatch(/budgetNote=\{tCommon\("tripTotal\.perPerson"\)\}/);
    expect(hero).toMatch(/budgetHint=\{tCommon\("tripTotal\.hint"\)\}/);
    expect(hero).not.toMatch(/trip\.budget/);
  });
});
