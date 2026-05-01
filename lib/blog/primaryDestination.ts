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
 */
export function getPrimaryDestinationFromTags(tags: string[] | undefined): Destination | null {
  if (!tags || tags.length === 0) return null;
  const normalized = tags.map((t) => t.toLowerCase().trim());
  for (const dest of destinations) {
    if (normalized.includes(dest.slug)) return dest;
    // Match common multi-word slugs by both hyphenated and spaced form
    const spaced = dest.slug.replace(/-/g, " ");
    if (normalized.includes(spaced)) return dest;
  }
  return null;
}
