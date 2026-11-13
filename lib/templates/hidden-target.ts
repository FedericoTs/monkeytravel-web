import { routing } from "@/lib/i18n/routing-config";
import { publicTripAlternates } from "@/lib/seo/public-trip";

/**
 * Where a template page sends its visitors while templates are hidden
 * (lib/templates/shown.ts): a template with a public trip page goes there, the
 * URL it already names as its own; the rest go to the planner, in the page's
 * language.
 */
export function hiddenTemplateTarget(
  locale: string,
  publicTrip?: { slug: string | null; tripMeta: unknown } | null
): string {
  if (publicTrip?.slug) {
    return new URL(publicTripAlternates(publicTrip.slug, publicTrip.tripMeta).canonical).pathname;
  }
  return `${locale === routing.defaultLocale ? "" : `/${locale}`}/trips/new`;
}
