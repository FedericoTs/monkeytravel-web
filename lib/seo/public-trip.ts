import { buildAlternates, type AlternatesResult } from "./canonical";
import { tripLocale } from "@/lib/ai/language";

/** Activities a public trip needs before its page is worth indexing (about one real day). */
export const MIN_ACTIVITIES_FOR_INDEX = 4;

type Day = { activities?: Array<{ name?: string | null }> | null };

export function countActivities(itinerary: Day[]): number {
  return itinerary.reduce(
    (sum, day) => sum + (Array.isArray(day.activities) ? day.activities.length : 0),
    0,
  );
}

/** Whether a public trip page is indexed and listed in the trip sitemap. */
export function isTripIndexable(itinerary: Day[]): boolean {
  return countActivities(itinerary) >= MIN_ACTIVITIES_FOR_INDEX;
}

/**
 * The one indexable URL of a public trip: the locale its itinerary is written
 * in (trip_meta.locale; English when unstamped). The other locales show the
 * same text under translated navigation, so they point there instead of
 * forming a hreflang cluster of copies.
 */
export function publicTripAlternates(slug: string, tripMeta: unknown): AlternatesResult {
  const locale = tripLocale(tripMeta) ?? "en";
  const { canonical } = buildAlternates(`/trip/${slug}`, { locale });
  return { canonical, languages: { [locale]: canonical, "x-default": canonical } };
}

/**
 * Activity names in order. Two published trips with the same fingerprint are
 * the same itinerary (a trip published twice, or a shared cached plan).
 */
export function itineraryFingerprint(itinerary: Day[]): string {
  return itinerary
    .map((day) => (day.activities ?? []).map((a) => (a.name ?? "").trim().toLowerCase()).join("|"))
    .join("||");
}
