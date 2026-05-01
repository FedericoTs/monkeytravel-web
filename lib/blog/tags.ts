import { getAllFrontmatter } from "./api";
import type { BlogFrontmatter } from "./types";

/**
 * Convert a free-form tag (e.g. "Asia Travel", "7 days") into a URL slug.
 * Lowercase, hyphenated, alpha-numeric only. Stable across locales as long
 * as the source tag string is the same.
 */
export function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
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
