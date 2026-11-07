import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildAlternates, SITE_URL } from "@/lib/seo/canonical";

/**
 * A planner landing page's generateMetadata: the title and description in its
 * messages (`meta.title`, `meta.description`), canonical and hreflang URLs, and
 * the Open Graph and Twitter cards.
 *
 * The title is `absolute`, outside the root "%s | MonkeyTravel" template:
 * these pages target generic commercial terms, where the brand buys nothing
 * and costs 15 of ~60 rendered characters. The homepage keeps it.
 */
export function landingMetadata(
  namespace: string,
  path: string,
  ogImageAlt: string
) {
  return async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace });
    const title = t("meta.title");
    const description = t("meta.description");
    const alternates = buildAlternates(path, { locale });
    return {
      title: { absolute: title },
      description,
      alternates,
      openGraph: {
        siteName: "MonkeyTravel",
        title,
        description,
        type: "website",
        url: alternates.canonical,
        images: [{ url: `${SITE_URL}/og-image.png`, width: 1200, height: 630, alt: ogImageAlt }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [`${SITE_URL}/og-image.png`],
      },
    };
  };
}
