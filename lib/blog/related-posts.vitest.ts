/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { getRelatedPosts, getAllFrontmatter } from "./api";

/**
 * getRelatedPosts used to call parseFrontmatter(slug) without the locale, so
 * the CURRENT post's tags came from the English file while the CANDIDATE posts'
 * tags came from the localized ones. Overlap was therefore almost always zero
 * and scores collapsed onto the +2 same-category bonus; ties resolve by
 * publishedAt DESC, so most posts in a category linked to the same three recent
 * posts. Measured on pt before the fix: 2 tag-matched links out of 252, 82 of
 * 84 posts with zero overlap, and one identical related-set on 20 posts.
 *
 * These tests run against the real content/blog tree rather than fixtures,
 * because the bug was invisible in any single-language fixture — it only exists
 * where the EN and localized tag vocabularies diverge.
 */

const LOCALES = ["en", "it", "es", "pt"] as const;

/**
 * Frontmatter for one locale, read once.
 *
 * getAllFrontmatter is wrapped in React's `cache()`, which is a no-op outside a
 * request context — calling it per slug re-read all 84 files each time (84x84
 * reads per locale) and blew the 5s test timeout. Hoisting it is the whole
 * difference between ~40s and ~2s.
 */
const frontmatterFor = new Map<string, ReturnType<typeof getAllFrontmatter>>();
function localeFrontmatter(locale: string) {
  let fm = frontmatterFor.get(locale);
  if (!fm) { fm = getAllFrontmatter(locale); frontmatterFor.set(locale, fm); }
  return fm;
}

/** Related links for `slug` that share at least one tag with it. */
function tagMatchedLinks(slug: string, locale: string): number {
  const own = localeFrontmatter(locale).find((f) => f.slug === slug);
  if (!own) return 0;
  const tags = new Set(own.tags);
  return getRelatedPosts(slug, 3, locale).filter((r) =>
    r.tags.some((t) => tags.has(t))
  ).length;
}

describe("getRelatedPosts — locale is honoured", () => {
  it.each(LOCALES)("%s: related posts are mostly tag-matched, not category-only", (locale) => {
    const slugs = localeFrontmatter(locale).map((f) => f.slug);
    const matched = slugs.reduce((n, s) => n + tagMatchedLinks(s, locale), 0);

    // Pre-fix pt scored 2/252 (0.8%). Post-fix all four locales sit above 45%.
    // 25% is a floor that the bug cannot pass but healthy content clears easily.
    const ratio = matched / (slugs.length * 3);
    expect(ratio).toBeGreaterThan(0.25);
  });

  it.each(LOCALES)("%s: related sets are varied, not the same recent posts everywhere", (locale) => {
    const slugs = localeFrontmatter(locale).map((f) => f.slug);
    const sets = new Set(
      slugs.map((s) => getRelatedPosts(s, 3, locale).map((r) => r.slug).join("|"))
    );

    // Pre-fix: pt produced 26 distinct sets across 84 posts, one of them on 20
    // pages. Post-fix every locale produces 60+.
    expect(sets.size).toBeGreaterThan(slugs.length * 0.5);
  });

  it("pt draws the current post's tags from the pt file, not the English one", () => {
    // The direct expression of the bug: a post whose pt tags are fully
    // translated must still find pt-tagged neighbours.
    const slug = "greek-island-hopping-itinerary";
    const own = localeFrontmatter("pt").find((f) => f.slug === slug);
    expect(own?.tags).toContain("roteiro santorini"); // pt, not "santorini itinerary"

    const related = getRelatedPosts(slug, 3, "pt");
    expect(related).toHaveLength(3);
    expect(related.every((r) => r.slug !== slug)).toBe(true);
  });

  it("never returns the post itself, and respects the limit", () => {
    for (const locale of LOCALES) {
      const slugs = localeFrontmatter(locale).map((f) => f.slug).slice(0, 10);
      for (const s of slugs) {
        const r = getRelatedPosts(s, 3, locale);
        expect(r.length).toBeLessThanOrEqual(3);
        expect(r.some((x) => x.slug === s)).toBe(false);
      }
    }
  });
});
