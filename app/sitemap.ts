import { MetadataRoute } from "next";
import { destinations } from "@/lib/destinations/data";
import { getAllSlugs as getBlogSlugs, getPostDates, hasLocaleTranslation } from "@/lib/blog/api";
import { getAllTagSlugs, getPostsByTagSlug, TAG_MIN_POSTS_FOR_INDEX } from "@/lib/blog/tags";
import { getAllAuthors } from "@/lib/blog/authors";

const locales = ["en", "es", "it", "pt"] as const;
const defaultLocale = "en";

// Hardcoded lastmod dates per content type — the genuine last time each type
// was meaningfully changed. Kept stable across rebuilds rather than declaring
// "everything changed today" on every build. We deliberately do NOT bump these
// to today just to provoke a recrawl: an INACCURATE lastmod is worse than a
// stale one — Google learns to ignore the signal entirely. Bump only when the
// content actually changes.
const LASTMOD_HOMEPAGE = "2026-04-30";
const LASTMOD_LANDING = "2026-04-15";
const LASTMOD_DESTINATIONS = "2026-04-15";
const LASTMOD_LEGAL = "2025-12-01";

// The pt locale shipped 2026-06-09 (commit 988c1f6 — 29 destinations + 65 blog
// posts). pt pages must NEVER carry an en/es/it date that PRE-DATES the pt
// content's existence — that was a real bug (pt URLs claiming 2026-04-15, two
// months before they existed; Google discounts pre-creation dates). `ptAware`
// clamps any base date up to the pt ship date for pt URLs only; en/es/it keep
// their honest dates untouched.
// TODO (proper fix): derive ALL of these from per-item content-stored dates,
// the way the blog already does via frontmatter `updatedAt`. fs mtime is
// unreliable on Vercel (git checkout resets it to build time).
const LASTMOD_PT_CONTENT = "2026-06-09";
function ptAware(locale: string, base: string): string {
  return locale === "pt" && base < LASTMOD_PT_CONTENT ? LASTMOD_PT_CONTENT : base;
}

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
    {
      url: `${baseUrl}/pt`,
      lastModified: LASTMOD_PT_CONTENT,
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

  // Contact page (× 3 locales). Indexable; supports brand-name searches like
  // "monkeytravel contact" and gives press/partnerships a stable URL to land on.
  const contactPages: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;
    contactPages.push({
      url: `${baseUrl}${prefix}/contact`,
      lastModified: ptAware(locale, LASTMOD_LANDING),
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  // SEO landing pages (× 3 locales)
  const landingPages: MetadataRoute.Sitemap = [];
  const seoLandingPaths = ['/free-ai-trip-planner', '/group-trip-planner', '/weekend-trip-planner', '/ai-itinerary-generator', '/family-trip-planner', '/budget-trip-planner', '/solo-trip-planner', '/backpacker'];

  // Free tools (× 3 locales). Listed alongside SEO landing pages since
  // they have similar discovery characteristics and lifetime cadence.
  // **2026-05-25**: added so /tools/* URLs are crawlable from day one
  // (the pages exist but were orphaned — only the nav + footer + home
  // section make them discoverable to humans; this makes them
  // discoverable to Googlebot too).
  const toolPaths = ['/tools', '/tools/packing-list', '/tools/visa-checker'];

  // **2026-05-29 (/explore Week 3)**: /explore is the freshest-content
  // page on the site (community UGC feed) and was completely absent
  // from the sitemap. PRIORITY_INDEX + daily changefreq signals high
  // crawl value. /saved is noindexed by design (personal list) — don't
  // include. We deliberately do NOT enumerate every filter combination
  // (e.g. /explore?budget=premium) to concentrate PageRank on a single
  // canonical entry-point rather than diluting it across N facets.
  const explorePaths = ['/explore'];

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? '' : `/${locale}`;
    for (const path of seoLandingPaths) {
      landingPages.push({
        url: `${baseUrl}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_LANDING),
        changeFrequency: 'monthly',
        priority: PRIORITY_LANDING,
      });
    }
    for (const path of toolPaths) {
      landingPages.push({
        url: `${baseUrl}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_LANDING),
        changeFrequency: 'monthly',
        priority: PRIORITY_LANDING,
      });
    }
    for (const path of explorePaths) {
      landingPages.push({
        url: `${baseUrl}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_HOMEPAGE),
        // Daily — explore feed re-ranks via trending_score every cron tick
        // and new UGC trips land continuously. We want Googlebot to come
        // back often, not the monthly cadence the SEO landing pages use.
        changeFrequency: 'daily',
        priority: PRIORITY_INDEX,
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
      lastModified: ptAware(locale, LASTMOD_DESTINATIONS),
      changeFrequency: "monthly",
      priority: PRIORITY_INDEX,
    });

    // Detail page per destination per locale
    for (const dest of destinations) {
      destinationPages.push({
        url: `${baseUrl}${prefix}/destinations/${dest.slug}`,
        lastModified: ptAware(locale, LASTMOD_DESTINATIONS),
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

    // Blog detail page per post per locale — but ONLY if a real per-locale
    // translation exists. EN-only posts (e.g. consolidation pillars) get a
    // single EN entry instead of 3 locale variants. This stops Google from
    // discovering /es/ /it/ URLs that serve EN-fallback content and would
    // be flagged as "Duplicate, Google chose different canonical than user".
    for (const slug of blogSlugs) {
      if (!hasLocaleTranslation(slug, locale)) continue;
      const dates = getPostDates(slug);
      blogPages.push({
        url: `${baseUrl}${prefix}/blog/${slug}`,
        lastModified: dates?.updatedAt ?? LASTMOD_HOMEPAGE,
        changeFrequency: "monthly",
        priority: PRIORITY_BLOG_DETAIL,
      });
    }
  }

  // Author bio pages — EN only. Author bios are English-only content; the /es/
  // and /it/ URLs render the same English text via locale routing and are
  // canonicalized to the EN version (see app/[locale]/about/authors/[slug]).
  const authorPages: MetadataRoute.Sitemap = getAllAuthors().map((author) => ({
    url: `${baseUrl}/about/authors/${author.slug}`,
    lastModified: LASTMOD_HOMEPAGE,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  // Blog tag landing pages (× 3 locales). Tags are localized so each
  // locale gets its own set of slugs.
  //
  // Skip "thin" tag archives — pages with only a handful of posts get
  // classified by Google as low-value duplicate aggregators ("Crawled —
  // currently not indexed") and burn crawl budget that should go to real
  // content. The page itself still renders if linked directly; we just
  // don't actively submit it for indexing.
  const tagPages: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;
    for (const tagSlug of getAllTagSlugs(locale)) {
      if (getPostsByTagSlug(tagSlug, locale).length < TAG_MIN_POSTS_FOR_INDEX) continue;
      tagPages.push({
        url: `${baseUrl}${prefix}/blog/tag/${tagSlug}`,
        lastModified: newestPostDate,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  // Destination style/vibe landing pages (× 3 locales). Tags here are the
  // taxonomic 'travel style' set, identical across locales (e.g. 'romantic',
  // 'foodie'). The pages themselves localize copy via translation keys.
  const STYLE_TAGS = [
    "romantic", "cultural", "foodie", "urban", "historical",
    "beach", "nightlife", "adventure", "nature", "wellness",
    "shopping", "offbeat",
  ];
  const stylePages: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;
    for (const styleTag of STYLE_TAGS) {
      stylePages.push({
        url: `${baseUrl}${prefix}/destinations/style/${styleTag}`,
        lastModified: ptAware(locale, LASTMOD_DESTINATIONS),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  return [...staticPages, ...contactPages, ...landingPages, ...destinationPages, ...blogPages, ...authorPages, ...tagPages, ...stylePages];
}
