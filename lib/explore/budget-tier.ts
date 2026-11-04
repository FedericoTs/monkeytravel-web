import { isBudgetTier, type BudgetTier } from "@/types";

/**
 * The tier a card may show, or null when it is simply not known.
 *
 * `trip_meta.budget_tier` is often null, and a default would show a price
 * signal ("$$") the data never carried. Unknown stays unknown; TripCard
 * hides the pill for null.
 */
export function asBudgetTier(value: unknown): BudgetTier | null {
  return isBudgetTier(value) ? value : null;
}

export const BUDGET_TIER_LABEL: Record<BudgetTier, string> = {
  budget: "$",
  balanced: "$$",
  premium: "$$$",
};
