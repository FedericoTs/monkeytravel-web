/**
 * Video data adapter — bridges lib/destinations/data.ts to Remotion components.
 *
 * We import destination data and flatten the localized strings for the
 * selected locale, making it easy to pass to video components.
 */

import { destinations } from '../lib/destinations/data';
import type { Locale } from '../lib/destinations/types';

export interface VideoDestinationData {
  slug: string;
  name: string;
  country: string;
  tagline: string;
  description: string;
  ctaText: string;
  tags: string[];
  highlights: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
  activities: Array<{
    time: string;
    type: string;
    title: string;
    description: string;
  }>;
  stats: {
    avgStayDays: number;
    bestMonths: number[];
    budgetLevel: number;
  };
}

/**
 * Get destination data flattened for a specific locale.
 * Returns null if destination slug not found.
 */
export function getDestinationData(
  slug: string,
  locale: Locale
): VideoDestinationData | null {
  const dest = destinations.find((d) => d.slug === slug);
  if (!dest) return null;

  return {
    slug: dest.slug,
    name: dest.name[locale],
    country: dest.country[locale],
    tagline: dest.content.tagline[locale],
    description: dest.content.description[locale],
    ctaText: dest.content.ctaText[locale],
    tags: dest.tags,
    highlights: dest.content.highlights.map((h) => ({
      icon: h.icon,
      title: h.title[locale],
      description: h.description[locale],
    })),
    activities: dest.content.sampleDay.activities.map((a) => ({
      time: a.time,
      type: a.type,
      title: a.title[locale],
      description: a.description[locale],
    })),
    stats: dest.stats,
  };
}

/**
 * Get all destination slugs — useful for batch rendering.
 */
export function getAllDestinationSlugs(): string[] {
  return destinations.map((d) => d.slug);
}
