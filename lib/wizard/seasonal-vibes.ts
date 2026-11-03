import { getSeasonalVibeSuggestions } from "@/lib/seasonal";
import { parseLocalDate } from "@/lib/utils/date-local";
import type { SeasonalContext, TripVibe } from "@/types";

/** The vibes step 2 offers (components/trip/VibeSelector.tsx). */
export const STEP2_VIBES: readonly TripVibe[] = ["adventure", "cultural", "foodie", "romantic", "nature", "urban"];

/**
 * The season's top two vibes among those step 2 offers, to start step 2 with
 * when the planner has picked none: the season's good defaults, with room for
 * a third of their own. Suggestions step 2 doesn't offer ("fairytale") are
 * skipped.
 */
export function seasonalVibeSeed(context: SeasonalContext, startDate: string): TripVibe[] {
  const month = (parseLocalDate(startDate) ?? new Date()).getMonth() + 1;
  return getSeasonalVibeSuggestions(context.season, context.holidays || [], month)
    .map((s) => s.vibeId)
    .filter((v) => STEP2_VIBES.includes(v))
    .slice(0, 2);
}
