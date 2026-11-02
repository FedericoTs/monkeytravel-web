import type { User } from "@supabase/supabase-js";
import { errors } from "@/lib/api/response-wrapper";
import { checkUsageLimit, type UsageCheckResult } from "@/lib/usage-limits";
import { getCachedItinerary, type SupportedLanguage } from "@/lib/ai/cache";
import type { GeneratedItinerary, TripCreationParams } from "@/types";

// Anonymous visitors have no monthly quota: they are capped by cookie and IP
// before the preflight.
const ANONYMOUS_USAGE = {
  allowed: true as const,
  used: 0,
  remaining: 999,
  limit: 999,
  message: undefined as string | undefined,
};

export type GenerationUsage = UsageCheckResult | typeof ANONYMOUS_USAGE;

/**
 * The two reads a generation starts with, run together: the signed-in
 * planner's monthly quota and the cross-user cache entry for the trip. They
 * touch different tables.
 */
export async function readGenerationPreflight(
  user: User | null,
  params: TripCreationParams,
  language: SupportedLanguage,
  totalDays: number
): Promise<{ usage: GenerationUsage; cached: GeneratedItinerary | null }> {
  const [usage, cached] = await Promise.all([
    user ? checkUsageLimit(user.id, "aiGenerations", user.email) : Promise.resolve(ANONYMOUS_USAGE),
    getCachedItinerary(
      null,
      params.destination,
      params.vibes,
      params.budgetTier,
      language,
      params.travelStyle ?? "classic",
      // Never accept an entry SHORTER than the trip being asked for.
      totalDays
    ),
  ]);
  return { usage, cached };
}

/** The answer when a signed-in planner has used up the month's generations. */
export function generationQuotaReached(usage: GenerationUsage) {
  return errors.rateLimit(usage.message || "Monthly trip generation limit reached.", {
    usage,
    upgradeUrl: "/pricing",
  });
}
