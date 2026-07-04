/**
 * Shared canonical + hreflang helper.
 *
 * Every indexable page needs the same two SEO signals:
 *   1. `alternates.canonical` — the single URL Google should attribute all
 *      ranking to (dedupes ?query variants, locale variants, etc.).
 *   2. `alternates.languages` — the hreflang map so Google clusters the
 *      per-locale variants (/en, /es, /it, /pt) as one page instead of
 *      four competing duplicates.
 *
 * Historically these were copy-pasted inline object literals on every
 * page (see the pre-existing /explore + /destinations pages). Divergent
 * copies drift — one page forgets `x-default`, another hardcodes the
 * wrong prefix. This helper is the single source of truth.
 *
 * Routing note: the app uses `localePrefix: 'as-needed'` with default
 * locale `en`, so English URLs are UNPREFIXED (`/trip/foo`) and the other
 * locales carry their segment (`/es/trip/foo`). `x-default` points at the
 * English (unprefixed) URL, matching every other page on the site.
 */

const SITE_URL = "https://monkeytravel.app";

/** Locales that carry an hreflang alternate. Mirrors lib/i18n/routing.ts. */
const HREFLANG_LOCALES = ["en", "es", "it", "pt"] as const;
const DEFAULT_LOCALE = "en";

export interface AlternatesResult {
  canonical: string;
  languages: Record<string, string>;
}

export interface BuildAlternatesOpts {
  /**
   * Which locale is currently rendering. Determines which URL becomes the
   * `canonical`. Defaults to the default locale (en) when omitted — useful
   * for locale-agnostic routes (sitemaps, feeds) that only need the map.
   */
  locale?: string;
}

/**
 * Build `{ canonical, languages }` for a given app-relative path.
 *
 * @param path  App-relative path starting with '/', WITHOUT any locale
 *              prefix — e.g. `/trip/santorini-6c40f334`. The locale prefix
 *              is added per-locale internally.
 * @param opts  `{ locale }` — the currently-rendering locale; picks the
 *              canonical. Falls back to the default locale.
 */
export function buildAlternates(
  path: string,
  opts?: BuildAlternatesOpts,
): AlternatesResult {
  const languages: Record<string, string> = {};

  for (const locale of HREFLANG_LOCALES) {
    const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
    languages[locale] = `${SITE_URL}${prefix}${path}`;
  }
  // x-default → the unprefixed (English) URL, matching the sitewide pattern.
  languages["x-default"] = `${SITE_URL}${path}`;

  const locale = opts?.locale ?? DEFAULT_LOCALE;
  const canonical = languages[locale] ?? languages[DEFAULT_LOCALE];

  return { canonical, languages };
}
