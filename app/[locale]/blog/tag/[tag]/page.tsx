import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import { getAllTagSlugs, resolveTagDisplay, getPostsByTagSlug, TAG_MIN_POSTS_FOR_INDEX } from "@/lib/blog/tags";
import { tOr } from "@/lib/blog/api";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { BlogCard } from "@/components/blog";
import { Link } from "@/lib/i18n/routing";

const SITE_URL = "https://monkeytravel.app";

// ============================================================================
// Static params + ISR — every (locale, tag) combination
// ============================================================================

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getAllTagSlugs(locale).map((tag) => ({ locale, tag }))
  );
}

// Same rationale as /blog index: tag archives derive from MDX frontmatter,
// only change on commits, 1h is conservative. See note in ../page.tsx — the
// `headers()` call inside `getNonce()` currently forces dynamic rendering and
// neutralises this directive. Kept for forward-compat with future CSP wiring.
export const revalidate = 3600;

// ============================================================================
// Metadata
// ============================================================================

interface PageProps {
  params: Promise<{ locale: string; tag: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, tag } = await params;
  const display = resolveTagDisplay(tag, locale);
  if (!display) return {};

  const t = await getTranslations({ locale, namespace: "blog" });
  const posts = getPostsByTagSlug(tag, locale);
  const title = t("tag.metaTitle", { tag: display });
  const description = t("tag.metaDescription", { tag: display, count: posts.length });

  // hreflang alternates — only emit for locales that actually have this tag
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    if (resolveTagDisplay(tag, l)) {
      const prefix = l === routing.defaultLocale ? "" : `/${l}`;
      languages[l] = `${SITE_URL}${prefix}/blog/tag/${tag}`;
    }
  }
  if (languages[routing.defaultLocale]) {
    languages["x-default"] = languages[routing.defaultLocale];
  }

  const ogLocaleMap: Record<string, string> = { en: "en_US", es: "es_ES", it: "it_IT", pt: "pt_BR" };
  const ogLocale = ogLocaleMap[locale] ?? "en_US";
  const alternateLocale = Object.values(ogLocaleMap).filter((l) => l !== ogLocale);

  // Thin tag archives get noindex,follow — page renders for users who land
  // on it, but Google drops it from the index (matches the sitemap exclusion
  // in app/sitemap.ts). Without this, previously-submitted thin tags stay
  // in Search Console's "Crawled — currently not indexed" bucket forever.
  const isThin = posts.length < TAG_MIN_POSTS_FOR_INDEX;

  return {
    title,
    description,
    robots: isThin ? { index: false, follow: true } : undefined,
    alternates: {
      canonical: languages[locale],
      languages,
    },
    openGraph: {
      title,
      description,
      url: languages[locale],
      siteName: "MonkeyTravel",
      type: "website",
      locale: ogLocale,
      alternateLocale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// ============================================================================
// Page
// ============================================================================

export default async function BlogTagPage({ params }: PageProps) {
  const { locale, tag } = await params;
  setRequestLocale(locale);

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  // A tag that no longer resolves (renamed/removed) or has lost all its posts
  // after a blog restructure used to hard-404 here. Google had indexed ~347 of
  // these /blog/tag/* URLs (en/es/it); the bulk 404 spiked in late April,
  // drained crawl budget, and FAILED Search Console validation on 2026-06-12.
  // Serve a permanent (308) redirect to the locale's blog index instead: Google
  // drops the dead tag URLs cleanly, link equity consolidates onto /blog, and
  // crawlers stop hammering pages that will never return. Valid tags (>=1 post)
  // fall through and render normally below.
  const display = resolveTagDisplay(tag, locale);
  if (!display) permanentRedirect(`${localePrefix}/blog`);

  const posts = getPostsByTagSlug(tag, locale);
  if (posts.length === 0) permanentRedirect(`${localePrefix}/blog`);

  const t = await getTranslations("blog");

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    { name: t("breadcrumbs.blog"), url: `${SITE_URL}${localePrefix}/blog` },
    { name: display, url: `${SITE_URL}${localePrefix}/blog/tag/${tag}` },
  ]);

  const nonce = await getNonce();

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />

      <Navbar />

      <main className="pt-20">
        {/* Hero */}
        <section className="py-14 sm:py-16 bg-gradient-to-b from-[var(--primary)]/5 to-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-2 text-sm text-[var(--foreground-muted)] mb-6">
              <Link href="/" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.home")}
              </Link>
              <span>/</span>
              <Link href="/blog" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.blog")}
              </Link>
              <span>/</span>
              <span className="text-[var(--foreground)] font-medium">{display}</span>
            </nav>

            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--primary)] mb-2">
              {t("tag.eyebrow")}
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
              #{display}
            </h1>
            <p className="text-lg text-[var(--foreground-muted)] max-w-2xl">
              {t("tag.subtitle", { count: posts.length })}
            </p>
          </div>
        </section>

        {/* Posts grid */}
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post) => (
                <BlogCard
                  key={post.slug}
                  post={post}
                  title={tOr(t, `posts.${post.slug}.title`, post.title)}
                  description={tOr(t, `posts.${post.slug}.description`, post.description)}
                  category={tOr(t, `categories.${post.category}`, post.category)}
                  readMoreLabel={t("index.readMore")}
                  minuteReadLabel={t("index.minuteRead", { minutes: post.readingTime })}
                />
              ))}
            </div>
          </div>
        </section>

        {/* SR-only nav — guarantees crawl discoverability of every linked post */}
        <nav aria-label={t("index.allPostsLabel")} className="sr-only">
          <h2>{t("index.allPostsLabel")}</h2>
          <ul>
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`}>{tOr(t, `posts.${post.slug}.title`, post.title)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <Footer />
    </>
  );
}
