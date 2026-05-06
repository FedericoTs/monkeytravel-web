import { getAllFrontmatter } from "./api";
import type { BlogFrontmatter } from "./types";

/**
 * Tag archives below this post count are noindexed and excluded from the
 * sitemap. Google flags single-post tag pages as low-value duplicate
 * aggregators and refuses to index them, which burns crawl budget that
 * should go to real content.
 */
export const TAG_MIN_POSTS_FOR_INDEX = 5;

// U+0300..U+036F is the Combining Diacritical Marks block — what NFKD
// produces when it splits an accented letter into base + mark.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Convert a free-form tag (e.g. "Asia Travel", "Japón") into a URL slug.
 *
 * Why the NFKD normalization step: JS `\w` is ASCII-only, so the previous
 * `[^\w\s-]` strip turned "Japón" into "japn" (not "japon"), producing
 * dead URLs like /blog/tag/japn that 404'd in Search Console. Decomposing
 * to NFKD then dropping combining marks keeps the unaccented base letters
 * before the ASCII filter runs.
 */
export function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * All unique tag slugs across all posts in the given locale.
 * Used by generateStaticParams for the /blog/tag/[tag] page.
 */
export function getAllTagSlugs(locale = "en"): string[] {
  const slugs = new Set<string>();
  for (const fm of getAllFrontmatter(locale)) {
    for (const tag of fm.tags ?? []) {
      const slug = slugifyTag(tag);
      if (slug) slugs.add(slug);
    }
  }
  return Array.from(slugs);
}

/**
 * Resolve the tag slug back to its display form (the original tag string).
 * Returns the first matching tag from the most recent post, or null if no
 * post in this locale has a tag matching the slug.
 */
export function resolveTagDisplay(slug: string, locale = "en"): string | null {
  for (const fm of getAllFrontmatter(locale)) {
    for (const tag of fm.tags ?? []) {
      if (slugifyTag(tag) === slug) return tag;
    }
  }
  return null;
}

/**
 * All posts that include the given tag slug, sorted desc by publishedAt.
 */
export function getPostsByTagSlug(slug: string, locale = "en"): BlogFrontmatter[] {
  return getAllFrontmatter(locale).filter((fm) =>
    (fm.tags ?? []).some((tag) => slugifyTag(tag) === slug)
  );
}
