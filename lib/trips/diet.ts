import type { UserProfilePreferences } from "@/types";

/** The diets a trip can ask for, in the order the planner shows them. */
export const DIETS = ["vegetarian", "vegan", "halal", "kosher", "gluten-free"] as const;
export type Diet = (typeof DIETS)[number];

/** The known diets in `raw`, in the planner's order; anything else ("none", free text) is dropped. */
export function dietsFrom(raw: unknown): Diet[] {
  return Array.isArray(raw) ? DIETS.filter((d) => raw.includes(d)) : [];
}

/** The diet the planner asked for this trip replaces the profile's; none asked, the profile's stays. */
export function withTripDiet(prefs: UserProfilePreferences, requested: unknown): UserProfilePreferences {
  const diets = dietsFrom(requested);
  return diets.length > 0 ? { ...prefs, dietaryPreferences: diets } : prefs;
}

/** A kept trip's diets, by the same rule as its plan: those the planner asked for, else its owner's profile's. */
export function keptTripDiets(tripMeta: unknown, ownerPreferences: unknown): Diet[] {
  const asked = dietsFrom((tripMeta as { dietary?: unknown } | null)?.dietary);
  return asked.length > 0 ? asked : dietsFrom((ownerPreferences as { dietaryPreferences?: unknown } | null)?.dietaryPreferences);
}
