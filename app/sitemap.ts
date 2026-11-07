import { MetadataRoute } from "next";
import { destinations } from "@/lib/destinations/data";
import { getAllSlugs as getBlogSlugs, getPostDates, hasLocaleTranslation } from "@/lib/blog/api";
import { getAllTagSlugs, getPostsByTagSlug, TAG_MIN_POSTS_FOR_INDEX } from "@/lib/blog/tags";
import { getAllAuthors } from "@/lib/blog/authors";
import { competitorSlugs } from "@/lib/comparison/competitors";
import { allPassportSlugs } from "@/lib/visa/passport-pages";
import { SITE_URL } from "@/lib/seo/canonical";
import { PLANNER_PAGES } from "@/lib/seo/planner-pages";

const locales = ["en", "es", "it", "pt"] as const;
const defaultLocale = "en";

// Hardcoded lastmod dates per content type — the genuine last time each type
// was meaningfully changed. Kept stable across rebuilds rather than declaring
// "everything changed today" on every build. We deliberately do NOT bump these
// to today just to provoke a recrawl: an INACCURATE lastmod is worse than a
// stale one — Google learns to ignore the signal entirely. Bump only when the
// content actually changes.
//
// The opposite failure is a value that falls behind its content. It has two
// consequences, the second worse than the first:
//   1. Google is told the page has not changed when it has.
//   2. `scripts/indexnow-submit.mts --since N` FILTERS ON LASTMOD, so the
//      page is silently excluded from every IndexNow submission.
// `sitemap-lastmod.vitest.ts` fails the suite when any constant below falls
// behind the newest commit touching the files it covers, so the rot cannot
// happen silently. Update the constant AND the path list together when
// content moves.
const LASTMOD_HOMEPAGE = "2026-11-07";
const LASTMOD_LANDING = "2026-11-07";
const LASTMOD_TOOLS = "2026-11-07";
const LASTMOD_EXPLORE = "2026-10-28";
const LASTMOD_DESTINATIONS = "2026-11-07";
const LASTMOD_LEGAL = "2026-11-06";

// The pt content only exists from LASTMOD_PT_CONTENT on. pt pages must NEVER
// carry an en/es/it date that PRE-DATES that (Google discounts pre-creation
// dates). `ptAware` clamps any base date up to LASTMOD_PT_CONTENT for pt URLs
// only; en/es/it keep their honest dates untouched.
// TODO (proper fix): derive ALL of these from per-item content-stored dates,
// the way the blog already does via frontmatter `updatedAt`. fs mtime is
// unreliable on Vercel (git checkout resets it to build time).
const LASTMOD_PT_CONTENT = "2026-06-09";
function ptAware(locale: string, base: string): string {
  return locale === "pt" && base < LASTMOD_PT_CONTENT ? LASTMOD_PT_CONTENT : base;
}

/** The latest of some YYYY-MM-DD dates (blog front matter). */
function newestDate(dates: Array<string | undefined>): string {
  return dates.filter((d): d is string => Boolean(d)).sort().pop() ?? LASTMOD_HOMEPAGE;
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

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    // Homepage (all locales)
    {
      url: SITE_URL,
      lastModified: LASTMOD_HOMEPAGE,
      changeFrequency: "weekly",
      priority: PRIORITY_HOMEPAGE,
    },
    {
      url: `${SITE_URL}/es`,
      lastModified: LASTMOD_HOMEPAGE,
      changeFrequency: "weekly",
      priority: PRIORITY_LOCALE_HOMEPAGE,
    },
    {
      url: `${SITE_URL}/it`,
      lastModified: LASTMOD_HOMEPAGE,
      changeFrequency: "weekly",
      priority: PRIORITY_LOCALE_HOMEPAGE,
    },
    {
      url: `${SITE_URL}/pt`,
      lastModified: LASTMOD_PT_CONTENT,
      changeFrequency: "weekly",
      priority: PRIORITY_LOCALE_HOMEPAGE,
    },
    // Legal pages (English only — content is not translated)
    {
      url: `${SITE_URL}/privacy`,
      lastModified: LASTMOD_LEGAL,
      changeFrequency: "yearly",
      priority: PRIORITY_LEGAL,
    },
    {
      url: `${SITE_URL}/terms`,
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
      url: `${SITE_URL}${prefix}/contact`,
      lastModified: ptAware(locale, LASTMOD_LANDING),
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  // SEO landing pages (× 3 locales)
  const landingPages: MetadataRoute.Sitemap = [];
  const seoLandingPaths = PLANNER_PAGES.map(({ path }) => path);

  // Free tools (× 3 locales). Listed alongside SEO landing pages since
  // they have similar discovery characteristics and lifetime cadence. Only
  // the nav + footer + home section link to /tools/*, which makes them
  // discoverable to humans; this makes them discoverable to Googlebot too.
  const toolPaths = ['/tools', '/tools/check-my-plan', '/tools/packing-list', '/tools/visa-checker', '/where-should-i-go'];

  // /explore is the freshest-content page on the site (community UGC
  // feed), so it is listed. PRIORITY_INDEX + daily changefreq signals high
  // crawl value. /saved is noindexed by design (personal list) — don't
  // include. We deliberately do NOT enumerate every filter combination
  // (e.g. /explore?budget=premium) to concentrate PageRank on a single
  // canonical entry-point rather than diluting it across N facets.
  const explorePaths = ['/explore'];

  // "<competitor> alternative" comparison pages. Bottom-funnel
  // branded search is the one SERP class a young domain can realistically win
  // — the incumbent never writes the page, so we compete against other small
  // sites rather than against their brand authority. Derived from the
  // competitor registry so adding a competitor never means editing the
  // sitemap. Monthly cadence: claims are re-verified, not rewritten.
  const comparePaths = competitorSlugs().map((slug) => `/compare/${slug}`);

  // Per-passport "where can I actually go" pages. Derived from the shortlist
  // in lib/visa/passport-pages.ts so adding a passport never means editing the
  // sitemap. The shortlist is chosen from Search Console audience, NOT all 199
  // passports — see that file for why.
  //
  // Weekly, not monthly: the underlying matrix is refreshed nightly from
  // upstream, so the content genuinely can change between crawls.
  const passportPaths = allPassportSlugs().map((slug) => `/passport/${slug}`);

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? '' : `/${locale}`;
    for (const path of seoLandingPaths) {
      landingPages.push({
        url: `${SITE_URL}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_LANDING),
        changeFrequency: 'monthly',
        priority: PRIORITY_LANDING,
      });
    }
    for (const path of toolPaths) {
      landingPages.push({
        url: `${SITE_URL}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_TOOLS),
        changeFrequency: 'monthly',
        priority: PRIORITY_LANDING,
      });
    }
    for (const path of comparePaths) {
      landingPages.push({
        url: `${SITE_URL}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_LANDING),
        changeFrequency: 'monthly',
        priority: PRIORITY_LANDING,
      });
    }
    for (const path of passportPaths) {
      landingPages.push({
        url: `${SITE_URL}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_LANDING),
        changeFrequency: 'weekly',
        priority: PRIORITY_LANDING,
      });
    }
    for (const path of explorePaths) {
      landingPages.push({
        url: `${SITE_URL}${prefix}${path}`,
        lastModified: ptAware(locale, LASTMOD_EXPLORE),
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
      url: `${SITE_URL}${prefix}/destinations`,
      lastModified: ptAware(locale, LASTMOD_DESTINATIONS),
      changeFrequency: "monthly",
      priority: PRIORITY_INDEX,
    });

    // Detail page per destination per locale
    for (const dest of destinations) {
      destinationPages.push({
        url: `${SITE_URL}${prefix}/destinations/${dest.slug}`,
        lastModified: ptAware(locale, LASTMOD_DESTINATIONS),
        changeFrequency: "monthly",
        priority: PRIORITY_DESTINATION_DETAIL,
      });
    }
  }

  // Blog pages (index + detail × 3 locales)
  const blogPages: MetadataRoute.Sitemap = [];
  const blogSlugs = getBlogSlugs();

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;

    // Blog index per locale: the newest post date in THAT locale, so Google
    // sees fresh activity each time we publish there.
    const localeSlugs = blogSlugs.filter((slug) => hasLocaleTranslation(slug, locale));
    blogPages.push({
      url: `${SITE_URL}${prefix}/blog`,
      lastModified: ptAware(
        locale,
        newestDate(localeSlugs.map((slug) => getPostDates(slug, locale)?.updatedAt)),
      ),
      changeFrequency: "weekly",
      priority: PRIORITY_INDEX,
    });

    // Blog detail page per post per locale — but ONLY if a real per-locale
    // translation exists. EN-only posts (e.g. consolidation pillars) get a
    // single EN entry instead of 3 locale variants. This stops Google from
    // discovering /es/ /it/ URLs that serve EN-fallback content and would
    // be flagged as "Duplicate, Google chose different canonical than user".
    for (const slug of localeSlugs) {
      const dates = getPostDates(slug, locale);
      blogPages.push({
        url: `${SITE_URL}${prefix}/blog/${slug}`,
        // ptAware here too: frontmatter `updatedAt` belongs to the POST, not to
        // the pt translation of it. 39 /pt/blog/ URLs were declaring dates from
        // Feb-May 2026 — before the pt locale existed — which is the same
        // pre-creation-date bug ptAware was written for, arriving by a
        // different route because blog posts carry their own dates. Posts
        // translated after the pt launch keep their real, later date.
        lastModified: ptAware(locale, dates?.updatedAt ?? LASTMOD_HOMEPAGE),
        changeFrequency: "monthly",
        priority: PRIORITY_BLOG_DETAIL,
      });
    }
  }

  // Author bio pages — EN only. Author bios are English-only content; the /es/
  // and /it/ URLs render the same English text via locale routing and are
  // canonicalized to the EN version (see app/[locale]/about/authors/[slug]).
  const authorPages: MetadataRoute.Sitemap = getAllAuthors().map((author) => ({
    url: `${SITE_URL}/about/authors/${author.slug}`,
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
      const tagged = getPostsByTagSlug(tagSlug, locale);
      if (tagged.length < TAG_MIN_POSTS_FOR_INDEX) continue;
      tagPages.push({
        url: `${SITE_URL}${prefix}/blog/tag/${tagSlug}`,
        // The archive changes when one of its own posts does.
        lastModified: ptAware(locale, newestDate(tagged.map((fm) => fm.updatedAt))),
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
        url: `${SITE_URL}${prefix}/destinations/style/${styleTag}`,
        lastModified: ptAware(locale, LASTMOD_DESTINATIONS),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  return [...staticPages, ...contactPages, ...landingPages, ...destinationPages, ...blogPages, ...authorPages, ...tagPages, ...stylePages];
}
