/**
 * Cross-linking utilities for blog ↔ destination internal links
 *
 * Maps blog posts to relevant destinations (and vice versa)
 * based on keyword matching in tags, categories, and slugs.
 */

import { destinations } from "@/lib/destinations/data";
import { getAllSlugs as getBlogSlugs, getPostTags } from "@/lib/blog/api";
import type { Destination } from "@/lib/destinations/types";

// ---------------------------------------------------------------------------
// Blog → Destination keyword map
// Maps destination slugs to keywords found in blog tags/slugs
// ---------------------------------------------------------------------------

const DESTINATION_KEYWORDS: Record<string, string[]> = {
  paris: ["paris", "france", "french", "europe"],
  rome: ["rome", "roma", "italy", "italia", "italian", "europe"],
  barcelona: ["barcelona", "spain", "españa", "spanish", "europe"],
  tokyo: ["tokyo", "japan", "japanese", "asia"],
  "new-york": ["new york", "nyc", "usa", "america", "american"],
  london: ["london", "england", "uk", "british", "europe"],
  amsterdam: ["amsterdam", "netherlands", "dutch", "europe"],
  prague: ["prague", "czech", "europe"],
  lisbon: ["lisbon", "lisboa", "portugal", "portuguese", "europe"],
  vienna: ["vienna", "austria", "austrian", "europe"],
  berlin: ["berlin", "germany", "german", "europe"],
  bangkok: ["bangkok", "thailand", "thai", "asia"],
  bali: ["bali", "indonesia", "asia"],
  seoul: ["seoul", "korea", "korean", "asia"],
  singapore: ["singapore", "asia"],
  cancun: ["cancun", "cancún", "mexico", "mexican", "caribbean"],
  "rio-de-janeiro": ["rio", "rio de janeiro", "brazil", "brazilian"],
  dubai: ["dubai", "uae", "middle east"],
  istanbul: ["istanbul", "turkey", "türkiye", "turkish"],
  marrakech: ["marrakech", "morocco", "moroccan", "africa"],
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
 * Scores by slug text match + tag matches for better relevance
 */
export function getBlogPostsForDestination(
  destSlug: string,
  limit = 3
): string[] {
  const keywords = DESTINATION_KEYWORDS[destSlug] ?? [destSlug];
  const allBlogSlugs = getBlogSlugs();

  const scored = allBlogSlugs.map((blogSlug) => {
    const blogText = blogSlug.replace(/-/g, " ");
    const slugMatches = keywords.filter((kw) => blogText.includes(kw)).length;

    // Also check blog post tags for keyword matches
    const tags = getPostTags(blogSlug);
    const tagText = tags.map((t) => t.toLowerCase()).join(" ");
    const tagMatches = keywords.filter((kw) => tagText.includes(kw)).length;

    return { slug: blogSlug, score: slugMatches * 2 + tagMatches };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.slug);
}
