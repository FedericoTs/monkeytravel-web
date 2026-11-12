/** @vitest-environment node */
/**
 * The assistant offers a new route for the whole trip, and its button plans the
 * trip anew along it, as the "plan another place" buttons do: the wizard's
 * multi-city rows take the route, and the plan is generated for the same dates.
 * Asserted against the source: the wizard is too large to render here, and the
 * panel's side is rendered in components/trip/AnonAssistantPanel.vitest.tsx.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r\n/g, "\n");
const handler = /const handlePlanRoute = \(route: RouteStop\[\]\) => \{\n([\s\S]*?)\n {2}\};/.exec(SRC)?.[1] ?? "";

describe("planning an offered route", () => {
  it("fills the multi-city rows with it and generates", () => {
    expect(handler).toContain("setMultiCityMode(true);");
    expect(handler).toContain("setCityRows(routeRows(route));");
    expect(handler).toContain("generateWhenSetRef.current = true;");
  });

  it("is offered only with multi-city on", () => {
    expect(SRC).toContain("onPlanRoute={MULTI_CITY_ENABLED ? handlePlanRoute : undefined}");
  });
});
