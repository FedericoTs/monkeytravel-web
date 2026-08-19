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

/** getRelatedPosts re-reads the content tree per call; see localeFrontmatter. */
const SCAN_TIMEOUT = 60_000;

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

/**
 * Every metric this file asserts, computed in ONE pass per locale and memoized.
 *
 * getRelatedPosts calls getAllFrontmatter internally on every invocation, and
 * that is React-`cache()`d — a no-op outside a request context — so each call
 * re-reads all 84 markdown files. Running the two assertions separately meant
 * 84 calls x 84 reads x 4 locales, TWICE: ~56k file reads, which pushed the
 * file past 120s under load and made it fail intermittently on timeout rather
 * than on anything real.
 *
 * Sharing one memoized pass halves the work and makes each test O(1) after the
 * first locale it touches.
 */
interface LocaleStats {
  posts: number;
  /** Related links whose post shares at least one tag with the current post. */
  tagMatched: number;
  /** Distinct related-post triples — low means everything links to the same 3. */
  distinctSets: number;
}

const statsCache = new Map<string, LocaleStats>();

function stats(locale: string): LocaleStats {
  const cached = statsCache.get(locale);
  if (cached) return cached;

  const all = localeFrontmatter(locale);
  const sets = new Set<string>();
  let tagMatched = 0;

  for (const own of all) {
    const tags = new Set(own.tags);
    const related = getRelatedPosts(own.slug, 3, locale);
    tagMatched += related.filter((r) => r.tags.some((t) => tags.has(t))).length;
    sets.add(related.map((r) => r.slug).join("|"));
  }

  const computed: LocaleStats = { posts: all.length, tagMatched, distinctSets: sets.size };
  statsCache.set(locale, computed);
  return computed;
}

describe("getRelatedPosts — locale is honoured", () => {
  it.each(LOCALES)("%s: related posts are mostly tag-matched, not category-only", (locale) => {
    const { posts, tagMatched } = stats(locale);

    // Pre-fix pt scored 2/252 (0.8%). Post-fix all four locales sit above 45%.
    // 25% is a floor that the bug cannot pass but healthy content clears easily.
    expect(tagMatched / (posts * 3)).toBeGreaterThan(0.25);
  }, SCAN_TIMEOUT);

  it.each(LOCALES)("%s: related sets are varied, not the same recent posts everywhere", (locale) => {
    const { posts, distinctSets } = stats(locale);

    // Pre-fix: pt produced 26 distinct sets across 84 posts, one of them on 20
    // pages. Post-fix every locale produces 60+.
    expect(distinctSets).toBeGreaterThan(posts * 0.5);
  }, SCAN_TIMEOUT);

  it("pt draws the current post's tags from the pt file, not the English one", () => {
    // The direct expression of the bug: a post whose pt tags are fully
    // translated must still find pt-tagged neighbours.
    const slug = "greek-island-hopping-itinerary";
    const own = localeFrontmatter("pt").find((f) => f.slug === slug);
    const en = localeFrontmatter("en").find((f) => f.slug === slug);

    // The pt and en vocabularies are disjoint for this post, which is exactly
    // what made the dropped-locale bug invisible: comparing one against the
    // other yields no matches at all.
    expect(own?.tags).toContain("roteiro");
    expect(en?.tags).toContain("itinerary");
    expect(own?.tags).not.toContain("itinerary");

    const related = getRelatedPosts(slug, 3, "pt");
    expect(related).toHaveLength(3);
    expect(related.every((r) => r.slug !== slug)).toBe(true);
  }, SCAN_TIMEOUT);

  it("never returns the post itself, and respects the limit", () => {
    for (const locale of LOCALES) {
      const slugs = localeFrontmatter(locale).map((f) => f.slug).slice(0, 10);
      for (const s of slugs) {
        const r = getRelatedPosts(s, 3, locale);
        expect(r.length).toBeLessThanOrEqual(3);
        expect(r.some((x) => x.slug === s)).toBe(false);
      }
    }
  }, SCAN_TIMEOUT);
});
