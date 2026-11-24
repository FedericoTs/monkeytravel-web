import { describe, expect, it } from "vitest";
import { readTripFacts, tripFactsFromMeta, tripFactsLines } from "./trip-facts";
import { travellersLine } from "@/lib/ai/trip-prompt";
import { paceBudgetPromptClause } from "@/lib/trip/pace";

/**
 * The assistant that edits a plan is told who it is for in the planner's own words: an edit to a family's evening
 * gets no bar, a vegetarian's new lunch is vegetarian, a relaxed trip isn't packed by a new day.
 */

describe("readTripFacts", () => {
  it("keeps what each fact may be, and nothing else", () => {
    expect(
      readTripFacts({ tripIntent: "family", childrenAges: ["teen", "under3", "baby"], pace: "relaxed", budgetTier: "premium", dietary: ["vegan", "none"] }),
    ).toEqual({ tripIntent: "family", childrenAges: ["under3", "teen"], pace: "relaxed", budgetTier: "premium", dietary: ["vegan"] });
    expect(readTripFacts({ tripIntent: "aliens", pace: "warp", budgetTier: "free", dietary: "vegan", childrenAges: "teen" })).toEqual({});
    expect(readTripFacts(null)).toEqual({});
    expect(readTripFacts("family")).toEqual({});
  });

  it("keeps children's ages only on a family's trip", () => {
    expect(readTripFacts({ tripIntent: "couple", childrenAges: ["teen"] })).toEqual({ tripIntent: "couple" });
    expect(readTripFacts({ childrenAges: ["teen"] })).toEqual({});
  });
});

describe("tripFactsFromMeta (a saved trip)", () => {
  it("reads the trip's own answers", () => {
    expect(
      tripFactsFromMeta({ trip_intent: "family", children_ages: ["3to6"], pace: "active", budget_tier: "budget", dietary: ["halal"] }, null),
    ).toEqual({ tripIntent: "family", childrenAges: ["3to6"], pace: "active", budgetTier: "budget", dietary: ["halal"] });
  });

  it("takes the budget from the budget column when the meta has none, and nothing from an empty trip", () => {
    expect(tripFactsFromMeta({}, { tier: "premium", total: 3000, currency: "EUR" })).toEqual({ budgetTier: "premium" });
    expect(tripFactsFromMeta({ budget_tier: "budget" }, { tier: "premium" })).toEqual({ budgetTier: "budget" });
    expect(tripFactsFromMeta(null, null)).toEqual({});
  });
});

describe("tripFactsLines", () => {
  it("says who the trip is for in the planner's words, and asks every change to fit", () => {
    const text = tripFactsLines({ tripIntent: "family", childrenAges: ["under3"], pace: "relaxed", budgetTier: "balanced", dietary: ["vegetarian", "gluten-free"] });
    expect(text).toContain("every day you change or add must fit it, unless the traveller asks for something else");
    expect(text).toContain(`- ${travellersLine({ tripIntent: "family", childrenAges: ["under3"] })}`);
    expect(text).toContain("Don't plan bars or late nights as stops.");
    expect(text).toContain("Budget: balanced");
    expect(text).toContain(`Pace: relaxed. A day you plan from scratch: ${paceBudgetPromptClause("relaxed")}.`);
    expect(text).toContain("Diet: Vegetarian (no meat or fish), Gluten-Free.");
    expect(text).toContain("Every place to eat or drink you add must suit it.");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("names only what it knows", () => {
    const couple = tripFactsLines({ tripIntent: "couple" });
    expect(couple).toContain(travellersLine({ tripIntent: "couple" }));
    expect(couple).not.toContain("Budget");
    expect(couple).not.toContain("Pace");
    expect(couple).not.toContain("Diet");
    expect(tripFactsLines({ dietary: ["kosher"] })).not.toContain("Travellers");
  });

  it("is nothing for a trip it knows nothing about", () => {
    expect(tripFactsLines({})).toBe("");
  });
});
