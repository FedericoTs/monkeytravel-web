import { POSTS } from "./tag-taxonomy";

/**
 * Article -> wizard prefill.
 *
 * WHAT THIS IS FOR
 * A reader finishing "3-day Paris itinerary" and tapping the CTA used to land
 * on /trips/new with only the destination filled and every other field empty —
 * so they re-entered, by hand, the trip the article had just spent 2,000 words
 * describing. This derives the rest of that trip from what the post already
 * declares, so the wizard opens holding the article's plan.
 *
 * WHERE THE VALUES COME FROM
 * Nothing here is invented. Every field is read off a signal the post already
 * carries, in this precedence:
 *
 *   1. The slug's own day count. "3-day-paris-itinerary" -> 3,
 *      "itinerario-puglia-5-giorni" -> 5. The most specific signal there is,
 *      and it is what the headline promises the reader.
 *   2. Taxonomy concepts (lib/blog/tag-taxonomy.ts), which are assigned per
 *      post and are language-independent — so es/it/pt derive identically to
 *      en, unlike anything keyed off localized tags.
 *   3. Nothing. A post with no trip in it (a comparison, a passport index, a
 *      stats report) returns an EMPTY prefill and the CTA stays a bare
 *      /trips/new. Same discipline as the destination CTA, which is absent on
 *      67 of 84 posts because those posts genuinely aren't about a place.
 *
 * The destination is NOT resolved here: it comes from
 * getPrimaryDestinationFromTags, which already matches localized tags against
 * the curated dataset. This module only adds what that can't express.
 *
 * WHY SO LITTLE IS DERIVED
 * The blanket rule is the failure mode this codebase has already paid for
 * once: keyword-matched landing links put /free-ai-trip-planner on 80 of 84
 * posts and carried almost no signal. So concepts map to a prefill only where
 * the concept IS the article's subject. `city-guide` is deliberately NOT
 * mapped to the `urban` vibe even though it would fire on 13 posts — a Paris
 * vs Barcelona comparison is tagged city-guide and is not a request for a
 * nightlife trip. Being wrong on the reader's behalf is worse than being empty.
 */

/** Vibes the step-2 UI actually renders. Legacy vibes are never prefilled. */
export type PrefillVibe =
  | "adventure"
  | "cultural"
  | "foodie"
  | "romantic"
  | "nature"
  | "urban";

export interface TripPrefill {
  /** Trip length in days, 1-14. Absent for multi-city (per-city nights owns it). */
  days?: number;
  /** Maps to the wizard's budgetTier. Only ever "budget" — see BUDGET_CONCEPT. */
  budget?: "budget" | "balanced" | "premium";
  /** At most 2. Step 2 requires >=1 vibe, so a correct one is a real unblock. */
  vibes?: PrefillVibe[];
  /** Open the wizard in multi-city route mode. */
  multi?: boolean;
}

/**
 * The single-city ceiling the wizard enforces (MAX_TRIP_DAYS in
 * NewTripWizard.tsx). A prefill above it would render a span the wizard
 * refuses to generate, so it is clamped here rather than surfaced as an error
 * the reader didn't cause.
 */
export const MAX_PREFILL_DAYS = 14;

/**
 * Concept -> vibe. Only concepts whose whole subject IS that vibe.
 *
 * `wellness-travel` is absent on purpose: the step-2 UI renders 6 core vibes
 * and `wellness` is a legacy value, so prefilling it would set a vibe the
 * reader cannot see selected or clear. One post is affected.
 */
const CONCEPT_TO_VIBE: Record<string, PrefillVibe> = {
  "food-travel": "foodie",
  "romantic-travel": "romantic",
  "nature-travel": "nature",
};

/**
 * A post about travelling cheaply should open the wizard on the budget tier —
 * but ONLY when that is what the post is about, which for this one concept
 * means it has to be the LEADING concept.
 *
 * `budget-travel` is the one ambiguous concept in the taxonomy: it covers both
 * "travel somewhere cheap" (cheapest-destinations-in-europe) and "money
 * admin while travelling" (group-trip-budget-how-to-split-costs). Reading a
 * guide to splitting a restaurant bill is not a request for a shoestring trip,
 * so a bare has-the-concept test set the tier wrongly on 4 of 9 posts.
 *
 * Leading-concept is not an invented ordering: landingPagesForPost already
 * treats concept order as most-significant-first when ranking planner links.
 *
 * The vibe concepts deliberately do NOT get this treatment — see
 * CONCEPT_TO_VIBE — because they are unambiguous. A post carrying
 * `nature-travel` anywhere in its list is about nature, and requiring it to
 * lead would drop best-fall-foliage-destinations, which is exactly a nature
 * trip.
 */
const BUDGET_CONCEPT = "budget-travel";

/**
 * Concept day-lengths, used only when the slug doesn't state one.
 * Deliberately coarse — these are the two length concepts in the taxonomy, and
 * a post that carries one without a number in its title is making exactly this
 * coarse a claim.
 */
const CONCEPT_DAYS: Array<[string, number]> = [
  ["weekend-trip", 3],
  ["week-long-trip", 7],
];

/**
 * Day count as stated by the slug itself.
 *
 * Handles the English form ("3-day-paris-itinerary", "london-4-day-itinerary")
 * and the Italian-authored slugs ("itinerario-puglia-5-giorni"), which are the
 * only two shapes in the blog. Returns null rather than guessing.
 */
export function daysFromSlug(slug: string): number | null {
  const m = /(?:^|-)(\d{1,2})-(?:days?|giorni|giorno|dias?)(?:-|$)/.exec(slug);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Derive the prefill for a post. Empty object when the post describes no trip.
 */
export function tripPrefillForPost(slug: string): TripPrefill {
  const entry = POSTS[slug];
  const concepts = new Set(entry?.c ?? []);
  const prefill: TripPrefill = {};

  // Multi-city, but only for posts that are actually a ROUTE. `multi-city-trip`
  // also sits on data posts (most-planned-destinations-2026 is a stats piece
  // that happens to count multi-city trips) — opening the route builder for a
  // reader of a statistics article is noise, so travel-data excludes it.
  const isRoute = concepts.has("multi-city-trip") && !concepts.has("travel-data");
  if (isRoute) {
    prefill.multi = true;
  }

  // Length. Slug beats concept: tokyo-4-day-itinerary carries `weekend-trip`,
  // and the headline's 4 is what the reader was promised.
  //
  // Skipped entirely in multi-city mode: there, the wizard derives the end date
  // from the sum of per-city nights, so a prefilled span would be overwritten
  // as soon as the route rows render — and a long single-city span heading into
  // a one-city route is the documented way to get a 400 from the generate call.
  if (!isRoute) {
    let days = daysFromSlug(slug);
    if (days === null) {
      for (const [concept, d] of CONCEPT_DAYS) {
        if (concepts.has(concept)) {
          days = d;
          break;
        }
      }
    }
    if (days !== null) {
      prefill.days = Math.min(Math.max(days, 1), MAX_PREFILL_DAYS);
    }
  }

  if ((entry?.c ?? [])[0] === BUDGET_CONCEPT) {
    prefill.budget = "budget";
  }

  const vibes: PrefillVibe[] = [];
  for (const [concept, vibe] of Object.entries(CONCEPT_TO_VIBE)) {
    if (concepts.has(concept) && !vibes.includes(vibe)) vibes.push(vibe);
  }
  if (vibes.length > 0) prefill.vibes = vibes.slice(0, 2);

  return prefill;
}

/**
 * Build the wizard href for a post.
 *
 * `destinationSlug` comes from getPrimaryDestinationFromTags (null on posts
 * that aren't about a place). A post can legitimately produce params without a
 * destination — "plan-weekend-getaway-with-ai" prefills 3 days and no city —
 * and that is still a better landing than a blank wizard.
 *
 * Returns a bare "/trips/new" when there is nothing honest to prefill, so the
 * query string is never decoration.
 */
export function tripsNewHrefForPost(
  slug: string,
  destinationSlug: string | null,
): string {
  const prefill = tripPrefillForPost(slug);
  const qs = new URLSearchParams();

  if (destinationSlug) qs.set("destination", destinationSlug);
  if (prefill.multi) qs.set("multi", "1");
  if (prefill.days) qs.set("days", String(prefill.days));
  if (prefill.budget) qs.set("budget", prefill.budget);
  if (prefill.vibes?.length) qs.set("vibes", prefill.vibes.join(","));

  const s = qs.toString();
  return s ? `/trips/new?${s}` : "/trips/new";
}
