import { destinations } from "@/lib/destinations/data";
import type { Destination } from "@/lib/destinations/types";

/**
 * Explicit blog-post → destination picks for the seasonal round-ups.
 *
 * WHY THIS EXISTS
 * `getDestinationsForBlogPost()` in lib/cross-links.ts scores destinations by
 * looking for keywords inside `slug + tags`. That works for a post tagged
 * "japan" or "europe". It cannot work for these four, because their tags are
 * generic taxonomy concepts — "seasonal", "monthly travel guide", "autumn
 * travel", "best destinations" — and the cities live only in the BODY.
 *
 * Measured before this file existed (running the real matcher):
 *   where-to-go-in-november  → NONE   (section did not render)
 *   where-to-go-in-december  → NONE   (section did not render)
 *   where-to-go-in-october   → NONE   (section did not render)
 *   monsoon-season-...       → tokyo, bangkok, bali
 *
 * So three of the four highest-traffic seasonal posts rendered no destination
 * section at all, and the fourth matched Tokyo — off-topic for a monsoon
 * article — purely because the post carries an "asia" tag and Tokyo's keyword
 * list contains "asia".
 *
 * These posts are ~975 organic sessions/month between them, against
 * /destinations/[slug] earning 66 clicks per QUARTER across 75 URLs. The
 * destination pages hold real, four-language, hand-written day plans that
 * almost nobody reaches; the traffic is here. This map is the join.
 *
 * THE RULE FOR EDITING THIS MAP
 * Only list a destination that (a) has a full entry in lib/destinations/data.ts
 * — so its activities are real and already translated — and (b) is genuinely a
 * good call for that post's season. Do not pad a post to three. A short,
 * honest block beats a padded one, and every entry below cites the section of
 * the article it comes from.
 */
const SEASONAL_PICKS: Record<string, string[]> = {
  // §1 "Thailand — The Cool Dry Season Opens", §6 "Marrakech, Morocco".
  // The other ten (Oman, Jordan, Kerala, Madeira, Oaxaca, Buenos Aires,
  // Cape Town, Egypt, Vietnam, New Zealand) have no destination entry, so
  // this post honestly yields two.
  "where-to-go-in-november": ["bangkok", "marrakech"],

  // §1 Vienna (Christmas markets), §8 Dubai, §11 Rio de Janeiro.
  "where-to-go-in-december": ["vienna", "dubai", "rio-de-janeiro"],

  // §2 "Kyoto & Japan", §6 "The Algarve & Lisbon", §11 "Bali, Indonesia".
  "where-to-go-in-october": ["kyoto", "lisbon", "bali"],

  // Bali is the article's #1 pick in "Places That Are GREAT During Monsoon".
  // Bangkok is the post's Thailand anchor: Thailand runs through both the
  // AVOID (Gulf islands) and GREAT (Chiang Mai/Chiang Rai) sections, and
  // Bangkok is the destination entry we hold for it. Tokyo — what the keyword
  // matcher returned — is deliberately NOT here.
  "monsoon-season-where-to-go-and-avoid": ["bali", "bangkok"],
};

const BY_SLUG = new Map(destinations.map((d) => [d.slug, d]));

/**
 * Curated destinations for a post, or null when the post is not one of the
 * seasonal round-ups. Null (not []) so callers can tell "no curation here,
 * fall back to the keyword matcher" apart from "curated to nothing".
 *
 * Unknown slugs are dropped rather than throwing: a typo here should cost one
 * card, not the whole article. `seasonal-destinations.vitest.ts` fails on any
 * slug that stops resolving, so the typo is caught in CI instead.
 */
export function seasonalDestinationsForPost(slug: string): Destination[] | null {
  const picks = SEASONAL_PICKS[slug];
  if (!picks) return null;
  return picks.map((s) => BY_SLUG.get(s)).filter((d): d is Destination => Boolean(d));
}

/** Post slugs carrying a curated list — used by the test and by tooling. */
export const SEASONAL_POST_SLUGS = Object.keys(SEASONAL_PICKS);

/** The raw map, exported so the test can assert every slug still resolves. */
export const SEASONAL_PICKS_RAW = SEASONAL_PICKS;
