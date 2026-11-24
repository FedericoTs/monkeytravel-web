/**
 * Who a trip is for and how it was planned, told to the assistant that edits
 * it, in the planner's own words (lib/ai/trip-prompt.ts): an edit to a
 * family's evening gets no bar, a vegetarian's new lunch is vegetarian, and a
 * relaxed trip isn't packed by a new day. The plan was made with these; without
 * them every edit was made for nobody in particular.
 */

import { DIET_LABELS, travellersLine } from "@/lib/ai/trip-prompt";
import { paceBudgetPromptClause } from "@/lib/trip/pace";
import { dietsFrom, type Diet } from "@/lib/trips/diet";
import { childAgeBands, isChosenTripIntent, type ChildAgeBand, type ChosenTripIntent } from "@/lib/wizard/answers";
import { isBudgetTier, TRIP_PACES, type BudgetTier, type TripPace } from "@/types";

export interface TripFacts {
  tripIntent?: ChosenTripIntent;
  /** A family's children's ages, as the planner asks them. */
  childrenAges?: ChildAgeBand[];
  pace?: TripPace;
  budgetTier?: BudgetTier;
  dietary?: Diet[];
}

const isPace = (value: unknown): value is TripPace => (TRIP_PACES as readonly unknown[]).includes(value);

/**
 * What a page says the trip is (the planner's assistant sends its answers), keeping only what each fact may be.
 * Anything else is left out, never refused: a fact is help for the edit, not a condition of it.
 */
export function readTripFacts(raw: unknown): TripFacts {
  if (!raw || typeof raw !== "object") return {};
  const { tripIntent, childrenAges, pace, budgetTier, dietary } = raw as Record<string, unknown>;
  const ages = tripIntent === "family" ? childAgeBands(childrenAges) : [];
  const diets = dietsFrom(dietary);
  return {
    ...(isChosenTripIntent(tripIntent) ? { tripIntent } : {}),
    ...(ages.length > 0 ? { childrenAges: ages } : {}),
    ...(isPace(pace) ? { pace } : {}),
    ...(isBudgetTier(budgetTier) ? { budgetTier } : {}),
    ...(diets.length > 0 ? { dietary: diets } : {}),
  };
}

/** A saved trip's facts: its trip_meta, and the budget column's tier when the meta has none. */
export function tripFactsFromMeta(meta: unknown, budget: unknown): TripFacts {
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  const tier = (budget && typeof budget === "object" ? (budget as { tier?: unknown }).tier : undefined) ?? undefined;
  return readTripFacts({
    tripIntent: m.trip_intent,
    childrenAges: m.children_ages,
    pace: m.pace,
    budgetTier: m.budget_tier ?? tier,
    dietary: m.dietary,
  });
}

/** The prompt's lines for them, or nothing when nothing is known. */
export function tripFactsLines(facts: TripFacts): string {
  const lines = [
    travellersLine({ tripIntent: facts.tripIntent, childrenAges: facts.childrenAges }),
    facts.budgetTier ? `Budget: ${facts.budgetTier}` : "",
    facts.pace ? `Pace: ${facts.pace}. A day you plan from scratch: ${paceBudgetPromptClause(facts.pace)}.` : "",
    facts.dietary?.length
      ? `Diet: ${facts.dietary.map((d) => DIET_LABELS[d] ?? d).join(", ")}. Every place to eat or drink you add must suit it.`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `Who the trip is for, as it was planned (every day you change or add must fit it):\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}
