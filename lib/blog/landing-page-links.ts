import { POSTS } from "./tag-taxonomy";
import { tagKeyForSlug } from "./tag-alternates";

/**
 * Internal links from blog content to the commercial planner pages.
 *
 * WHY THIS REPLACES THE KEYWORD MATCHING
 * getLandingPagesForBlogPost scored English keyword lists against the post slug
 * plus its tags. Two problems, both measured:
 *
 *  1. The distribution was degenerate. /free-ai-trip-planner listed "travel",
 *     "trip" and "itinerary" as keywords, so it matched 80 of 84 posts, and
 *     /ai-itinerary-generator matched 53. Meanwhile /group-trip-planner got 9,
 *     /budget-trip-planner 9, /solo-trip-planner 4, and /multi-city-trip-planner
 *     and /family-trip-planner got NONE. A link on 95% of pages carries almost
 *     no topical signal, while the pages that could actually rank for a specific
 *     commercial query had nothing pointing at them.
 *
 *  2. The keywords are English, but tags are localized. it/es/pt therefore
 *     matched on the slug alone and produced ~20% fewer links (142/133/131 vs
 *     168), on exactly the locales that need the help most.
 *
 * Mapping the TAXONOMY CONCEPT instead fixes both: concepts are assigned per
 * post in lib/blog/tag-taxonomy.ts and are language-independent, so every locale
 * gets an identical, deliberate set of links.
 *
 * WHAT THIS IS AND IS NOT
 * This is the structural prerequisite for the planner pages to rank — it is not
 * a ranking strategy. They are already good pages (800-1,100 words, FAQPage +
 * SoftwareApplication schema, fully localized) sitting on a site with an
 * authority problem. Better internal linking distributes what authority exists
 * and tells Google what each page is for; it will not by itself win a
 * competitive commercial term.
 */

export interface LandingPageLink {
  path: string;
  /** Key under blog.detail.relatedToolsLabels in messages/<locale>/blog.json */
  labelKey: string;
}

/**
 * Taxonomy concept -> the page a reader of that concept should be sent to.
 *
 * Deliberately NOT exhaustive. /family-trip-planner has no entry because no
 * post in the blog is about family travel — inventing a mapping would put an
 * irrelevant link on unrelated posts, which is the exact failure being fixed
 * here. That page needs content, not a link rule.
 */
const CONCEPT_TO_LANDING: Record<string, LandingPageLink> = {
  "group-travel": { path: "/group-trip-planner", labelKey: "groupTripPlanner" },
  "budget-travel": { path: "/budget-trip-planner", labelKey: "budgetTripPlanner" },
  "solo-travel": { path: "/solo-trip-planner", labelKey: "soloTripPlanner" },
  "weekend-trip": { path: "/weekend-trip-planner", labelKey: "weekendTripPlanner" },
  "multi-city-trip": { path: "/multi-city-trip-planner", labelKey: "multiCityTripPlanner" },
  "travel-documents": { path: "/tools/visa-checker", labelKey: "visaChecker" },
  "travel-checklist": { path: "/tools/packing-list", labelKey: "packingList" },
  "itinerary": { path: "/ai-itinerary-generator", labelKey: "aiItineraryGenerator" },
  "ai-trip-planner": { path: "/free-ai-trip-planner", labelKey: "freeTripPlanner" },
};

/**
 * The two pages that describe the product generally rather than a trip type.
 *
 * They stay eligible everywhere — they are the best-converting surfaces
 * (/free-ai-trip-planner generated on 50% of its sessions), so removing the CTA
 * from most posts would trade a real conversion surface for a marginal SEO
 * gain. They are ranked LAST instead, so the specific page always takes the
 * primary slot when one applies.
 */
const GENERIC = new Set(["/ai-itinerary-generator", "/free-ai-trip-planner"]);

const FALLBACK: LandingPageLink = {
  path: "/free-ai-trip-planner",
  labelKey: "freeTripPlanner",
};

/**
 * Planner links for a blog post, most specific first.
 *
 * Returns the pages matching the post's own concepts, ordered so a trip-type
 * page outranks a generic one, then tops up with the fallback so every post
 * still offers a way into the product.
 */
export function landingPagesForPost(slug: string, limit = 3): LandingPageLink[] {
  const concepts = POSTS[slug]?.c ?? [];

  const matched = concepts
    .map((c) => CONCEPT_TO_LANDING[c])
    .filter((lp): lp is LandingPageLink => Boolean(lp));

  // Stable de-dupe, specific before generic.
  const seen = new Set<string>();
  const ordered: LandingPageLink[] = [];
  for (const pass of [false, true]) {
    for (const lp of matched) {
      if (GENERIC.has(lp.path) !== pass) continue;
      if (seen.has(lp.path)) continue;
      seen.add(lp.path);
      ordered.push(lp);
    }
  }

  if (!seen.has(FALLBACK.path)) ordered.push(FALLBACK);
  return ordered.slice(0, limit);
}

/**
 * The single planner page a tag archive should point at, or null.
 *
 * Tag archives are topic hubs: 20 per locale clear TAG_MIN_POSTS_FOR_INDEX and
 * are in the sitemap, so /blog/tag/group-travel -> /group-trip-planner is a
 * precise hub-to-commercial-page signal. Only ONE link, and only a specific
 * page — a generic filler here would put the same link on every archive and
 * recreate the dilution this module exists to remove.
 */
export function landingPageForTag(tagSlug: string, locale: string): LandingPageLink | null {
  const key = tagKeyForSlug(tagSlug, locale);
  if (!key) return null;
  const lp = CONCEPT_TO_LANDING[key];
  if (!lp || GENERIC.has(lp.path)) return null;
  return lp;
}

export { CONCEPT_TO_LANDING, GENERIC };
