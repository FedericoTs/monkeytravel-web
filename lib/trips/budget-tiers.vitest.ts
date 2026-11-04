import { describe, expect, it } from "vitest";
import { BUDGET_TIERS, isBudgetTier, type TripCreationParams } from "@/types";
import { validateTripParams } from "./request-validation";

/**
 * The budget tiers are declared once, in BUDGET_TIERS: the server, kept plans,
 * the wizard's buttons and the explore filters all go by it.
 */
describe("the trip's budget tiers", () => {
  it("are told apart from anything else", () => {
    for (const tier of BUDGET_TIERS) expect(isBudgetTier(tier), tier).toBe(true);
    for (const other of ["Budget", "luxury", "moderate", "", " balanced", 1, null, undefined]) {
      expect(isBudgetTier(other), String(other)).toBe(false);
    }
  });

  it("are each one the server takes, and nothing else is", () => {
    const request = (budgetTier: string) =>
      validateTripParams({
        destination: "Lisbon",
        startDate: "2099-08-11",
        endDate: "2099-08-15",
        budgetTier,
        pace: "moderate",
        vibes: ["cultural"],
        interests: [],
      } as unknown as TripCreationParams);
    for (const tier of BUDGET_TIERS) expect(request(tier), tier).toEqual({ valid: true });
    expect(request("lavish")).toEqual({ valid: false, error: "Invalid budget tier" });
  });
});
