/**
 * The interests each vibe stands for: the plan's request and a saved trip's tags take them, from whichever vibes
 * the planner picked (the wizard's, or a session tray plan's).
 */
const VIBE_TO_INTERESTS: Record<string, string[]> = {
  adventure: ["adventure", "nature", "photography"],
  cultural: ["culture", "history", "art"],
  foodie: ["food", "culture"],
  romantic: ["relaxation", "photography"],
  nature: ["nature", "photography", "adventure"],
  urban: ["nightlife", "shopping", "art"],
};

/** The vibes' interests, each once, in the order the vibes and their interests come. */
export function interestsFromVibes(vibes: readonly string[]): string[] {
  const interests = new Set<string>();
  for (const vibe of vibes) for (const interest of VIBE_TO_INTERESTS[vibe] ?? []) interests.add(interest);
  return [...interests];
}
