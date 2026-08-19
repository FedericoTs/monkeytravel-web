import { slugifyTag } from "./tags";
import { CONCEPTS, DESTINATION_NAMES, LOCALES, type Locale } from "./tag-taxonomy";

/**
 * Cross-locale equivalents for a tag archive slug.
 *
 * THE PROBLEM THIS SOLVES
 * /blog/tag/[tag] built its hreflang alternates by asking whether THE SAME SLUG
 * resolved in each locale. Tags are localized, so that only ever linked archives
 * whose slug happens to be spelled identically in two languages — `asia`, and
 * little else. `europe` never saw `europa`; `itinerary` never saw `itinerario`
 * or `roteiro`. Measured on production: of 80 tag URLs in the sitemap, 71 were
 * hreflang-isolated and only 4 had a complete four-locale cluster.
 *
 * It also produced ASYMMETRIC clusters, which is worse than none: on
 * /it/blog/tag/europa the slug `europa` resolves in it, es and pt but not en, so
 * that page advertised three alternates while the English page advertised only
 * itself. Google requires hreflang to be reciprocal and discards sets that
 * aren't.
 *
 * The taxonomy already knows that `europe`/`europa`/`europa`/`europa` are one
 * concept, so the mapping is just a matter of reading it in the other direction:
 * slug -> concept key -> that concept's slug in every locale.
 *
 * WHY THIS MATTERS BEYOND TIDINESS
 * The open Search Console problem is es/it/pt pages sitting in "crawled —
 * currently not indexed". A correct hreflang cluster is how Google is told that
 * 20 archives per locale are four translations of one set rather than 80
 * unrelated thin aggregators.
 */

/** A tag's slug in each locale that has one. */
export type AlternateSlugs = Partial<Record<Locale, string>>;

interface Index {
  /** taxonomy key (concept or destination) -> its slug per locale */
  byKey: Map<string, AlternateSlugs>;
  /** "<locale>:<slug>" -> taxonomy key */
  keyBySlug: Map<string, string>;
  /** slugs that more than one key claims within a single locale */
  collisions: string[];
}

function buildIndex(): Index {
  const byKey = new Map<string, AlternateSlugs>();
  const keyBySlug = new Map<string, string>();
  const collisions: string[] = [];

  const add = (key: string, names: Record<Locale, string>) => {
    const slugs: AlternateSlugs = {};
    for (const locale of LOCALES) {
      const slug = slugifyTag(names[locale]);
      if (!slug) continue;
      slugs[locale] = slug;

      // Two taxonomy entries resolving to one slug in one locale would make the
      // reverse lookup ambiguous. First registration wins so behaviour stays
      // deterministic; tag-alternates.vitest.ts asserts the list stays empty.
      const scoped = `${locale}:${slug}`;
      if (keyBySlug.has(scoped)) collisions.push(`${scoped} (${keyBySlug.get(scoped)} vs ${key})`);
      else keyBySlug.set(scoped, key);
    }
    byKey.set(key, slugs);
  };

  for (const [key, names] of Object.entries(CONCEPTS)) add(key, names);
  for (const [key, names] of Object.entries(DESTINATION_NAMES)) add(key, names);

  return { byKey, keyBySlug, collisions };
}

const index = buildIndex();

/** Exposed so a test can assert the taxonomy has no ambiguous slugs. */
export const SLUG_COLLISIONS = index.collisions;

/**
 * The equivalent tag slug in each locale, given a slug as written in `locale`.
 *
 * Returns null for a slug the taxonomy does not know — a hand-written tag, or
 * one retired by an earlier pass — in which case the caller should fall back to
 * the previous same-slug behaviour rather than dropping alternates entirely.
 */
export function tagAlternateSlugs(slug: string, locale: string): AlternateSlugs | null {
  const key = index.keyBySlug.get(`${locale}:${slug}`);
  if (!key) return null;
  return index.byKey.get(key) ?? null;
}

/** The taxonomy key a slug belongs to, or null. Useful for diagnostics. */
export function tagKeyForSlug(slug: string, locale: string): string | null {
  return index.keyBySlug.get(`${locale}:${slug}`) ?? null;
}
