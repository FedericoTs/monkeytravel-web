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

export interface TagLink {
  slug: string;
  display: string;
}

/**
 * Tag archives that are indexed and in the sitemap (TAG_MIN_POSTS_FOR_INDEX
 * posts or more), most posts first. The only tags worth linking to: a link
 * to a noindexed archive spends crawl on a page Google is told to drop.
 */
export function getIndexableTags(locale = "en"): TagLink[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const fm of getAllFrontmatter(locale)) {
    const seen = new Set<string>();
    for (const tag of fm.tags ?? []) {
      const slug = slugifyTag(tag);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const entry = counts.get(slug);
      if (entry) entry.count++;
      else counts.set(slug, { display: tag, count: 1 });
    }
  }
  return [...counts.entries()]
    .filter(([, { count }]) => count >= TAG_MIN_POSTS_FOR_INDEX)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([slug, { display }]) => ({ slug, display }));
}

/** The post's own tags that have an indexed archive, in the post's order. */
export function getIndexableTagsForPost(tags: string[] | undefined, locale = "en"): TagLink[] {
  const indexable = new Set(getIndexableTags(locale).map((t) => t.slug));
  const out: TagLink[] = [];
  for (const tag of tags ?? []) {
    const slug = slugifyTag(tag);
    if (indexable.has(slug) && !out.some((t) => t.slug === slug)) out.push({ slug, display: tag });
  }
  return out;
}
