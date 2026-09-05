import type { BudgetTier } from "./types";

export const BUDGET_TIERS: readonly BudgetTier[] = ["budget", "balanced", "premium"];

/**
 * The tier a card may show, or null when it is simply not known.
 *
 * Measured 2026-09-05: `trip_meta.budget_tier` was null on all 55 feed
 * trips, and the card rendered "$$" for every one of them — a price signal
 * the data never carried. Unknown now stays unknown; TripCard hides the
 * pill for null. Live Trip plan, Phase 1.4.
 */
export function asBudgetTier(value: unknown): BudgetTier | null {
  return typeof value === "string" && (BUDGET_TIERS as readonly string[]).includes(value)
    ? (value as BudgetTier)
    : null;
}

export const BUDGET_TIER_LABEL: Record<BudgetTier, string> = {
  budget: "$",
  balanced: "$$",
  premium: "$$$",
};
