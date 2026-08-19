/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { getAllFrontmatter } from "./api";
import { slugifyTag, getPostsByTagSlug, TAG_MIN_POSTS_FOR_INDEX } from "./tags";
import { getPrimaryDestinationFromTags } from "./primaryDestination";
import { RETIRED_TAG_REDIRECTS, retiredTagTarget } from "./retired-tags";
import { destinations } from "@/lib/destinations/data";
import { CONCEPTS, DESTINATION_NAMES, POSTS, tagsFor } from "./tag-taxonomy";

/**
 * The blog tags were free-form per post: 276-296 distinct tags per locale
 * across 84 posts, 84-88% of them appearing exactly once. A singleton tag
 * cannot match a related post and its archive is noindexed as thin, so the
 * vocabulary was doing almost no work. scripts/normalize-blog-tags.mts moved
 * every post onto a fixed taxonomy.
 *
 * These tests pin the properties that make that worth having, and the two
 * invariants the pass had to preserve: destination CTAs and indexed tag URLs.
 */

const LOCALES = ["en", "it", "es", "pt"] as const;

/**
 * These suites walk all 336 content files. getAllFrontmatter is wrapped in
 * React cache(), which is a no-op outside a request context, so repeated calls
 * re-read from disk. Comfortable standalone, over the 5s default when the full
 * suite is competing for CPU.
 */
const SCAN_TIMEOUT = 60_000;

describe("taxonomy integrity", () => {
  it("every post has an assignment and every assignment names a real post", () => {
    const slugs = getAllFrontmatter("en").map((f) => f.slug).sort();
    expect(Object.keys(POSTS).sort()).toEqual(slugs);
  });

  it("every concept defines a string for all four locales", () => {
    for (const [key, byLocale] of Object.entries(CONCEPTS)) {
      for (const locale of LOCALES) {
        expect(byLocale[locale], `${key}.${locale}`).toBeTruthy();
      }
    }
  });

  it("DESTINATION_NAMES stays in sync with lib/destinations/data", () => {
    // The script duplicates these names rather than importing the app module.
    // This is what keeps the copy honest.
    for (const [slug, names] of Object.entries(DESTINATION_NAMES)) {
      const dest = destinations.find((d) => d.slug === slug);
      expect(dest, `destination "${slug}" no longer exists`).toBeDefined();
      for (const locale of LOCALES) {
        expect(dest!.name[locale], `${slug}.${locale}`).toBe(names[locale]);
      }
    }
  });

  it("frontmatter on disk matches the taxonomy, in every locale", () => {
    for (const locale of LOCALES) {
      for (const fm of getAllFrontmatter(locale)) {
        expect(fm.tags, `${locale}/${fm.slug}`).toEqual(tagsFor(fm.slug, locale));
      }
    }
  }, SCAN_TIMEOUT);
});

describe("the vocabulary actually does work", () => {
  it.each(LOCALES)("%s: is compact and mostly non-singleton", (locale) => {
    const counts = new Map<string, number>();
    for (const fm of getAllFrontmatter(locale)) {
      for (const t of fm.tags) {
        const s = slugifyTag(t);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    // Was 276-296 distinct with 231-260 singletons before the pass.
    expect(counts.size).toBeLessThan(60);

    // The remaining singletons are destination tags, which exist to drive the
    // CTA rather than to populate an archive. Concept singletons must stay rare.
    const singletons = [...counts.values()].filter((n) => n === 1).length;
    expect(singletons).toBeLessThan(15);
  }, SCAN_TIMEOUT);

  it.each(LOCALES)("%s: enough archives clear the indexing threshold", (locale) => {
    // Counted in ONE pass rather than calling getPostsByTagSlug per slug: that
    // helper re-reads all 84 files each call (React cache() is a no-op outside
    // a request), which is 49x84 reads and blows the default timeout whenever
    // the full suite is competing for CPU.
    const counts = new Map<string, number>();
    for (const fm of getAllFrontmatter(locale)) {
      for (const s of new Set(fm.tags.map(slugifyTag))) {
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    const indexable = [...counts.values()].filter((n) => n >= TAG_MIN_POSTS_FOR_INDEX);
    // 4-8 before the pass, 20 after. 15 is a floor with room for editing.
    expect(indexable.length).toBeGreaterThanOrEqual(15);
  }, SCAN_TIMEOUT);

  it("all four locales carry the same number of tags per post", () => {
    // Parity is the point: a post should be findable the same way in every
    // language, and getRelatedPosts should reach the same conclusion.
    for (const fm of getAllFrontmatter("en")) {
      const counts = LOCALES.map((l) => tagsFor(fm.slug, l).length);
      expect(new Set(counts).size, `${fm.slug}: ${counts.join("/")}`).toBe(1);
    }
  });
});

describe("destination CTA invariant", () => {
  /** Posts the taxonomy says are about one specific city. */
  const withDestination = Object.entries(POSTS).filter(([, p]) => p.d?.length);

  it("resolves a destination in EVERY locale, not just English", () => {
    // The bug this guards: destination slugs are English ("rome") but localized
    // posts tag "roma"/"tóquio", so the CTA silently vanished on es/it/pt.
    for (const [slug] of withDestination) {
      for (const locale of LOCALES) {
        const dest = getPrimaryDestinationFromTags(tagsFor(slug, locale), locale);
        expect(dest, `${locale}/${slug}`).not.toBeNull();
      }
    }
  });

  it("resolves to the SAME destination in every locale", () => {
    for (const [slug, post] of withDestination) {
      const resolved = LOCALES.map(
        (l) => getPrimaryDestinationFromTags(tagsFor(slug, l), l)?.slug
      );
      expect(new Set(resolved).size, `${slug}: ${resolved.join("/")}`).toBe(1);
      expect(resolved[0]).toBe(post.d![0]);
    }
  });

  it("stays suppressed on multi-destination posts", () => {
    // A single-destination CTA on a ten-city roundup misrepresents the article.
    for (const slug of ["greek-island-hopping-itinerary", "best-food-destinations-2026", "where-to-go-in-august", "passport-power-index-2026"]) {
      for (const locale of LOCALES) {
        expect(
          getPrimaryDestinationFromTags(tagsFor(slug, locale), locale),
          `${locale}/${slug}`
        ).toBeNull();
      }
    }
  });
});

describe("retired tag archives", () => {
  it("every retired slug points at an archive that exists and has posts", () => {
    for (const [locale, map] of Object.entries(RETIRED_TAG_REDIRECTS)) {
      for (const [from, to] of Object.entries(map)) {
        // Redirecting to a slug that resolves to nothing would just bounce the
        // crawler on to /blog, losing exactly what the redirect exists to keep.
        expect(getPostsByTagSlug(to, locale).length, `${locale}: ${from} -> ${to}`)
          .toBeGreaterThanOrEqual(TAG_MIN_POSTS_FOR_INDEX);
      }
    }
  }, SCAN_TIMEOUT);

  it("no retired slug still resolves (otherwise the redirect never fires)", () => {
    for (const [locale, map] of Object.entries(RETIRED_TAG_REDIRECTS)) {
      for (const from of Object.keys(map)) {
        expect(getPostsByTagSlug(from, locale).length, `${locale}/${from}`).toBe(0);
      }
    }
  }, SCAN_TIMEOUT);

  it("leaves English alone — every indexed English tag survived the pass", () => {
    expect(retiredTagTarget("comparison", "en")).toBeNull();
    expect(getPostsByTagSlug("comparison", "en").length).toBeGreaterThanOrEqual(
      TAG_MIN_POSTS_FOR_INDEX
    );
  }, SCAN_TIMEOUT);

  it("preserves the previously-indexed archives that were NOT renamed", () => {
    // These URLs are in the sitemap today; the pass must not evaporate them.
    const survivors: Array<[string, string]> = [
      ["en", "itinerary"], ["en", "city-guide"], ["en", "budget-travel"],
      ["en", "ai-trip-planner"], ["en", "seasonal"], ["en", "comparison"],
      ["it", "itinerario"], ["it", "guida-citta"], ["it", "stagionale"],
      ["es", "itinerario"], ["es", "guia-de-ciudad"], ["es", "estacional"],
      ["pt", "roteiro"], ["pt", "comparacao"], ["pt", "viagem-economica"],
      ["pt", "guia-da-cidade"], ["pt", "sazonal"], ["pt", "planejador-de-viagens-com-ia"],
    ];
    for (const [locale, slug] of survivors) {
      expect(getPostsByTagSlug(slug, locale).length, `${locale}/${slug}`)
        .toBeGreaterThanOrEqual(TAG_MIN_POSTS_FOR_INDEX);
    }
  }, SCAN_TIMEOUT);
});
