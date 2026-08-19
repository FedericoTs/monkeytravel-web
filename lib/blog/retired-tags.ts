/**
 * Tag archives that were renamed by the vocabulary normalization pass.
 *
 * WHY THIS EXISTS
 * /blog/tag/[tag] already handles a tag that no longer resolves: it serves a
 * 308 to the locale's /blog index rather than a 404, which was the fix for ~347
 * indexed tag URLs breaking in April. That is the right default for the ~250
 * thin, noindexed tags this pass retires per locale — they were never in the
 * sitemap and carry nothing worth preserving.
 *
 * But seven retired slugs were INDEXED (>= TAG_MIN_POSTS_FOR_INDEX posts, so in
 * the sitemap and eligible to rank), and each has a direct successor holding
 * the same posts. Sending those to /blog would dump their accumulated equity on
 * a page that has nothing to do with them. They redirect to the archive that
 * replaced them instead.
 *
 * Five of the seven are renames for correctness, not restructuring:
 *   - it/es `comparison` and it/es `budget-travel` were untranslated English
 *     tags sitting in Italian and Spanish frontmatter.
 *   - es `datos-de-planificacion-de-viajes` and pt
 *     `dados-de-planejamento-de-viagem` were long-tail phrasings of what is now
 *     simply "travel data".
 *   - pt `planejamento-de-viagem-em-grupo` collapses into `viagem-em-grupo`.
 *
 * Keys and values are TAG SLUGS (the output of slugifyTag), not display strings.
 * English is absent by design: every indexed English tag survived the pass.
 *
 * HOW THIS LIST WAS BUILT, and how to rebuild it: scripts/check-tag-url-impact.ts
 * diffs the pre-pass content against the post-pass content. Run it against the
 * OLD tree (git archive <ref> content/blog) — and note that the first attempt
 * under-reported it, because a `/^tags:\s*(.*)$/m` parser lets `\s*` cross the
 * newline and swallow the first item of every YAML block list. Two indexed
 * archives were invisible that way. Match the whole block, never line-by-line.
 */

const RETIRED_TAG_REDIRECTS: Record<string, Record<string, string>> = {
  it: {
    comparison: "confronto",
    "budget-travel": "viaggi-economici",
  },
  es: {
    comparison: "comparacion",
    "budget-travel": "viajes-economicos",
    "datos-de-planificacion-de-viajes": "datos-de-viaje",
  },
  pt: {
    "dados-de-planejamento-de-viagem": "dados-de-viagem",
    "planejamento-de-viagem-em-grupo": "viagem-em-grupo",
  },
};

/**
 * The tag slug that replaced `slug` in this locale, or null if the slug was not
 * renamed (in which case the caller should fall back to redirecting to /blog).
 */
export function retiredTagTarget(slug: string, locale: string): string | null {
  return RETIRED_TAG_REDIRECTS[locale]?.[slug] ?? null;
}

export { RETIRED_TAG_REDIRECTS };
