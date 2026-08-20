/**
 * The site's social preview card.
 *
 * WHY THIS EXISTS
 *
 * Next merges `metadata` shallowly: a page-level `openGraph` block REPLACES
 * the root layout's, it does not deep-merge. So any page that declares
 * `openGraph` without `images` silently drops `og:image` — the tag simply
 * vanishes from the HTML with no error, no warning, and no build failure.
 *
 * That had happened to ten pages including the homepage, the most-shared URL
 * on the site. The same applies to `twitter` blocks and `twitter:image`.
 *
 * So: any page that declares `openGraph` must also spread `images` in, and
 * this is the one place that defines them.
 *
 * The URL is relative on purpose — `metadataBase` in `app/layout.tsx` resolves
 * it to an absolute URL, which is what scrapers require. Do NOT switch this to
 * the `app/opengraph-image.*` file convention: explicit metadata overrides it,
 * and those dynamic routes previously 404'd in production.
 */

/** Path of the shared 1200x630 card in /public. */
export const OG_IMAGE_PATH = "/og-image.png";

/**
 * `openGraph.images` for a page.
 * @param alt Describe the page, not the picture — scrapers show this when the
 *            image fails to load.
 */
export function ogImages(alt: string) {
  return [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt }];
}

/** `twitter.images` — same asset; 1200x630 satisfies summary_large_image. */
export const twitterImages = [OG_IMAGE_PATH];
