import { MetadataRoute } from "next";
import { destinations } from "@/lib/destinations/data";
import { getAllSlugs as getBlogSlugs, getPostDates } from "@/lib/blog/api";
import { getAllTagSlugs } from "@/lib/blog/tags";

const locales = ["en", "es", "it"] as const;
const defaultLocale = "en";

// Hardcoded lastmod dates per content type — keeps the sitemap stable across
// rebuilds rather than declaring "everything changed today" on every build,
// which trains Google to ignore the lastmod signal entirely.
// Bump these when the corresponding content actually changes.
const LASTMOD_HOMEPAGE = "2026-04-30";
const LASTMOD_LANDING = "2026-04-15";
const LASTMOD_DESTINATIONS = "2026-04-15";
const LASTMOD_LEGAL = "2025-12-01";

// Most-important pages get the highest priority signal so Google clusters them
// at the top of the crawl queue when budget is tight.
const PRIORITY_HOMEPAGE = 1.0;
const PRIORITY_LOCALE_HOMEPAGE = 0.9;
const PRIORITY_LANDING = 0.9;
const PRIORITY_INDEX = 0.8;
const PRIORITY_BLOG_DETAIL = 0.7;
const PRIORITY_DESTINATION_DETAIL = 0.7;
const PRIORITY_LEGAL = 0.3;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://monkeytravel.app";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    // Homepage (all locales)
    {
      url: baseUrl,
      lastModified: LASTMOD_HOMEPAGE,
      changeFrequency: "weekly",
      priority: PRIORITY_HOMEPAGE,
    },
    {
      url: `${baseUrl}/es`,
      lastModified: LASTMOD_HOMEPAGE,
      changeFrequency: "weekly",
      priority: PRIORITY_LOCALE_HOMEPAGE,
    },
    {
      url: `${baseUrl}/it`,
      lastModified: LASTMOD_HOMEPAGE,
      changeFrequency: "weekly",
      priority: PRIORITY_LOCALE_HOMEPAGE,
    },
    // Legal pages (English only — content is not translated)
    {
      url: `${baseUrl}/privacy`,
      lastModified: LASTMOD_LEGAL,
      changeFrequency: "yearly",
      priority: PRIORITY_LEGAL,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: LASTMOD_LEGAL,
      changeFrequency: "yearly",
      priority: PRIORITY_LEGAL,
    },
    // Auth pages excluded — noindexed by auth/layout.tsx
  ];

  // SEO landing pages (× 3 locales)
  const landingPages: MetadataRoute.Sitemap = [];
  const seoLandingPaths = ['/free-ai-trip-planner', '/group-trip-planner', '/weekend-trip-planner', '/ai-itinerary-generator', '/family-trip-planner', '/budget-trip-planner', '/solo-trip-planner'];

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? '' : `/${locale}`;
    for (const path of seoLandingPaths) {
      landingPages.push({
        url: `${baseUrl}${prefix}${path}`,
        lastModified: LASTMOD_LANDING,
        changeFrequency: 'monthly',
        priority: PRIORITY_LANDING,
      });
    }
  }

  // Destination pages (index + detail × 3 locales)
  const destinationPages: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;

    // Index page per locale
    destinationPages.push({
      url: `${baseUrl}${prefix}/destinations`,
      lastModified: LASTMOD_DESTINATIONS,
      changeFrequency: "monthly",
      priority: PRIORITY_INDEX,
    });

    // Detail page per destination per locale
    for (const dest of destinations) {
      destinationPages.push({
        url: `${baseUrl}${prefix}/destinations/${dest.slug}`,
        lastModified: LASTMOD_DESTINATIONS,
        changeFrequency: "monthly",
        priority: PRIORITY_DESTINATION_DETAIL,
      });
    }
  }

  // Blog pages (index + detail × 3 locales)
  const blogPages: MetadataRoute.Sitemap = [];
  const blogSlugs = getBlogSlugs();

  // Use the most-recent post date as the blog index lastmod so Google sees
  // fresh activity each time we publish, without the index changing every build.
  const newestPostDate = blogSlugs
    .map((slug) => getPostDates(slug)?.updatedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? LASTMOD_HOMEPAGE;

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;

    // Blog index page per locale
    blogPages.push({
      url: `${baseUrl}${prefix}/blog`,
      lastModified: newestPostDate,
      changeFrequency: "weekly",
      priority: PRIORITY_INDEX,
    });

    // Blog detail page per post per locale
    for (const slug of blogSlugs) {
      const dates = getPostDates(slug);
      blogPages.push({
        url: `${baseUrl}${prefix}/blog/${slug}`,
        lastModified: dates?.updatedAt ?? LASTMOD_HOMEPAGE,
        changeFrequency: "monthly",
        priority: PRIORITY_BLOG_DETAIL,
      });
    }
  }

  // Blog tag landing pages (× 3 locales). Tags are localized so each
  // locale gets its own set of slugs.
  const tagPages: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;
    for (const tagSlug of getAllTagSlugs(locale)) {
      tagPages.push({
        url: `${baseUrl}${prefix}/blog/tag/${tagSlug}`,
        lastModified: newestPostDate,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  return [...staticPages, ...landingPages, ...destinationPages, ...blogPages, ...tagPages];
}
