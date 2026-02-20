/**
 * Cross-linking utilities for blog ↔ destination internal links
 *
 * Maps blog posts to relevant destinations (and vice versa)
 * based on keyword matching in tags, categories, and slugs.
 */

import { destinations } from "@/lib/destinations/data";
import { getAllSlugs as getBlogSlugs } from "@/lib/blog/api";
import type { Destination } from "@/lib/destinations/types";

// ---------------------------------------------------------------------------
// Blog → Destination keyword map
// Maps destination slugs to keywords found in blog tags/slugs
// ---------------------------------------------------------------------------

const DESTINATION_KEYWORDS: Record<string, string[]> = {
  paris: ["paris", "france", "europe"],
  rome: ["rome", "roma", "italy", "italia", "europe"],
  florence: ["florence", "firenze", "italy", "italia", "tuscany", "europe"],
  tokyo: ["tokyo", "japan", "asia"],
  kyoto: ["kyoto", "japan", "asia"],
  barcelona: ["barcelona", "spain", "españa", "europe"],
  london: ["london", "england", "uk", "europe"],
  istanbul: ["istanbul", "turkey", "türkiye"],
  "new-york": ["new york", "nyc", "usa", "america"],
  bangkok: ["bangkok", "thailand", "asia"],
  lisbon: ["lisbon", "lisboa", "portugal", "europe"],
  "buenos-aires": ["buenos aires", "argentina", "south america"],
  marrakech: ["marrakech", "morocco", "africa"],
  prague: ["prague", "czech", "europe"],
  singapore: ["singapore", "asia"],
  "cape-town": ["cape town", "south africa", "africa"],
  bali: ["bali", "indonesia", "asia"],
  dubai: ["dubai", "uae", "middle east"],
  melbourne: ["melbourne", "australia", "oceania"],
  mexico: ["mexico city", "mexico", "cdmx", "america"],
};

/**
 * Find destinations relevant to a blog post based on its tags and slug
 */
export function getDestinationsForBlogPost(
  blogSlug: string,
  blogTags: string[],
  limit = 3
): Destination[] {
  const searchText = [
    blogSlug.replace(/-/g, " "),
    ...blogTags.map((t) => t.toLowerCase()),
  ].join(" ");

  const scored = destinations.map((dest) => {
    const keywords = DESTINATION_KEYWORDS[dest.slug] ?? [dest.slug];
    const matches = keywords.filter((kw) => searchText.includes(kw)).length;
    return { destination: dest, score: matches };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.destination);
}

/**
 * Find blog post slugs relevant to a destination
 * Returns slugs that have matching keywords in their slug text
 */
export function getBlogPostsForDestination(
  destSlug: string,
  limit = 3
): string[] {
  const keywords = DESTINATION_KEYWORDS[destSlug] ?? [destSlug];
  const allBlogSlugs = getBlogSlugs();

  const scored = allBlogSlugs.map((blogSlug) => {
    const blogText = blogSlug.replace(/-/g, " ");
    const matches = keywords.filter((kw) => blogText.includes(kw)).length;
    return { slug: blogSlug, score: matches };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.slug);
}
