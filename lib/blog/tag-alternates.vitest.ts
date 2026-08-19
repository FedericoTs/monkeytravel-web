/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { tagAlternateSlugs, tagKeyForSlug, SLUG_COLLISIONS } from "./tag-alternates";
import { CONCEPTS, DESTINATION_NAMES, LOCALES, tagsFor, type Locale } from "./tag-taxonomy";
import { slugifyTag, TAG_MIN_POSTS_FOR_INDEX } from "./tags";
import { getAllFrontmatter } from "./api";

/**
 * hreflang on tag archives used to be built by testing whether the SAME slug
 * resolved in each locale. Tags are localized, so that only linked archives
 * spelled identically across languages: on production, 71 of 80 sitemap tag
 * URLs were isolated and 4 had a full cluster. Worse, some were asymmetric
 * (/it/blog/tag/europa advertised es+pt+it while /blog/tag/europe advertised
 * only en), and Google discards non-reciprocal hreflang.
 */

const SCAN_TIMEOUT = 60_000;

describe("tag alternates", () => {
  it("has no ambiguous slugs — one slug per locale maps to one taxonomy key", () => {
    // If two concepts collapsed onto one slug in a locale, the reverse lookup
    // would be a coin flip and clusters would cross-link wrongly.
    expect(SLUG_COLLISIONS).toEqual([]);
  });

  it("maps a concept slug to its equivalent in every locale", () => {
    // The exact case the old code missed.
    expect(tagAlternateSlugs("europe", "en")).toEqual({
      en: "europe", it: "europa", es: "europa", pt: "europa",
    });
    expect(tagAlternateSlugs("itinerario", "it")).toEqual({
      en: "itinerary", it: "itinerario", es: "itinerario", pt: "roteiro",
    });
    expect(tagAlternateSlugs("roteiro", "pt")?.en).toBe("itinerary");
  });

  it("maps destination slugs too, across their localized names", () => {
    expect(tagAlternateSlugs("tokyo", "en")).toEqual({
      en: "tokyo", it: "tokyo", es: "tokio", pt: "toquio",
    });
    expect(tagKeyForSlug("parigi", "it")).toBe("paris");
  });

  it("returns null for a slug the taxonomy does not know", () => {
    // Callers fall back to same-slug behaviour rather than dropping alternates.
    expect(tagAlternateSlugs("some-hand-written-tag", "en")).toBeNull();
    expect(tagAlternateSlugs("europe", "it")).toBeNull(); // "europe" is not an it slug
  });

  it("every taxonomy key resolves from each of its own locale slugs", () => {
    for (const [key, names] of [...Object.entries(CONCEPTS), ...Object.entries(DESTINATION_NAMES)]) {
      for (const locale of LOCALES) {
        const slug = slugifyTag(names[locale as Locale]);
        expect(tagKeyForSlug(slug, locale), `${locale}:${slug}`).toBe(key);
      }
    }
  });
});

describe("clusters are reciprocal", () => {
  /** Every distinct tag slug actually present in the content, per locale. */
  const liveSlugs = (locale: string) =>
    new Set(getAllFrontmatter(locale).flatMap((f) => f.tags.map(slugifyTag)));

  it("A links to B implies B links back to A, for every live tag", () => {
    // Non-reciprocal hreflang is worse than none — Google drops the whole set.
    for (const locale of LOCALES) {
      for (const slug of liveSlugs(locale)) {
        const alts = tagAlternateSlugs(slug, locale);
        expect(alts, `${locale}/${slug} is not in the taxonomy`).not.toBeNull();
        for (const [other, otherSlug] of Object.entries(alts!)) {
          const back = tagAlternateSlugs(otherSlug, other);
          expect(back?.[locale as Locale], `${locale}/${slug} -> ${other}/${otherSlug} did not link back`)
            .toBe(slug);
        }
      }
    }
  }, SCAN_TIMEOUT);

  it("every indexable archive gets a complete four-locale cluster", () => {
    // Counts precomputed in ONE pass per locale. getPostsByTagSlug re-reads all
    // 84 files on every call (React cache() is a no-op outside a request), so
    // calling it per slug per locale is ~49x4x5 full scans and never finishes.
    const counts = new Map<string, number>();
    for (const locale of LOCALES) {
      for (const fm of getAllFrontmatter(locale)) {
        for (const s of new Set(fm.tags.map(slugifyTag))) {
          const k = `${locale}:${s}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }

    // The taxonomy is applied uniformly, so a concept that clears the indexing
    // threshold in one locale clears it in all four and must cluster fully.
    for (const locale of LOCALES) {
      for (const slug of liveSlugs(locale)) {
        if ((counts.get(`${locale}:${slug}`) ?? 0) < TAG_MIN_POSTS_FOR_INDEX) continue;
        const alts = tagAlternateSlugs(slug, locale)!;
        expect(Object.keys(alts).sort(), `${locale}/${slug}`).toEqual([...LOCALES].sort());
        for (const [other, otherSlug] of Object.entries(alts)) {
          expect(counts.get(`${other}:${otherSlug}`) ?? 0, `${other}/${otherSlug} is empty`)
            .toBeGreaterThan(0);
        }
      }
    }
  }, SCAN_TIMEOUT);

  it("the alternate slug is the one the other locale's posts actually carry", () => {
    // Guards the failure where the map is internally consistent but disagrees
    // with the frontmatter on disk.
    const sample = ["3-day-paris-itinerary", "where-to-go-in-october", "seoul-5-day-itinerary"];
    for (const post of sample) {
      for (const locale of LOCALES) {
        for (const tag of tagsFor(post, locale)) {
          const alts = tagAlternateSlugs(slugifyTag(tag), locale)!;
          for (const other of LOCALES) {
            const expected = tagsFor(post, other).map(slugifyTag);
            expect(expected, `${post} ${locale}:${tag} -> ${other}`).toContain(alts[other]);
          }
        }
      }
    }
  }, SCAN_TIMEOUT);
});
