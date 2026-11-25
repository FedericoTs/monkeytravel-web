import { describe, expect, it } from "vitest";
import { hiddenTemplateTarget } from "./hidden-target";

describe("hiddenTemplateTarget", () => {
  it("sends a template with a public trip page to that page, in the trip's own language", () => {
    expect(hiddenTemplateTarget("en", { slug: "kyoto-1a2b3c4d", tripMeta: { locale: "it" } })).toBe("/it/trip/kyoto-1a2b3c4d");
    expect(hiddenTemplateTarget("es", { slug: "kyoto-1a2b3c4d", tripMeta: {} })).toBe("/trip/kyoto-1a2b3c4d");
  });

  it("sends the rest to the planner, in the page's language", () => {
    expect(hiddenTemplateTarget("en")).toBe("/trips/new");
    expect(hiddenTemplateTarget("es")).toBe("/es/trips/new");
    expect(hiddenTemplateTarget("pt", { slug: null, tripMeta: { locale: "it" } })).toBe("/pt/trips/new");
    expect(hiddenTemplateTarget("it", null)).toBe("/it/trips/new");
  });
});
