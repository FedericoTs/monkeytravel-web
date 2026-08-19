import { destinations } from "@/lib/destinations/data";
import type { Destination } from "@/lib/destinations/types";

/**
 * Find the post's primary destination by matching tags against known
 * destination slugs. The first hit wins. Used to surface a personalized
 * "plan this trip" CTA on the article page.
 *
 * Returns null when no tag resolves to a destination (general guides,
 * comparison posts, region-wide articles), in which case the caller
 * should suppress the CTA rather than fall back to a generic one.
 *
 * WHY THE LOCALE MATTERS
 * Destination slugs are English (`rome`, `tokyo`) but blog frontmatter is
 * authored per locale, so an Italian post tags `roma` and a Portuguese one
 * tags `tóquio`. Matching slugs alone therefore resolved on English posts and
 * silently failed on es/it/pt, suppressing the CTA on every localized article
 * whose city name is spelled differently — which is most of them. Passing the
 * locale lets the destination's own localized name match too.
 *
 * The locale is optional so existing English-only callers are unaffected;
 * omitting it keeps the previous slug-only behaviour.
 */
export function getPrimaryDestinationFromTags(
  tags: string[] | undefined,
  locale?: string
): Destination | null {
  if (!tags || tags.length === 0) return null;
  const normalized = new Set(tags.map((t) => t.toLowerCase().trim()));

  for (const dest of destinations) {
    if (normalized.has(dest.slug)) return dest;
    // Match common multi-word slugs by both hyphenated and spaced form
    if (normalized.has(dest.slug.replace(/-/g, " "))) return dest;

    // The destination's name as written in this locale ("roma", "tóquio",
    // "nueva york"). Guarded because `locale` is a plain string from the route
    // and may not be a key of the name map.
    const localized = locale
      ? (dest.name as Record<string, string | undefined>)[locale]
      : undefined;
    if (localized && normalized.has(localized.toLowerCase())) return dest;
  }
  return null;
}
