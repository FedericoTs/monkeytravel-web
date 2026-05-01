import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import { getAllPosts } from "@/lib/blog/api";
import { generateBreadcrumbSchema, generateCollectionPageSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BlogGrid from "@/components/blog/BlogGrid";
import { BlogLane, FeaturedHero } from "@/components/blog";
import ContentTracker from "@/components/analytics/ContentTracker";
import { Link } from "@/lib/i18n/routing";
import type { BlogFrontmatter } from "@/lib/blog/types";

const SITE_URL = "https://monkeytravel.app";

// ============================================================================
// Static params
// ============================================================================

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// ============================================================================
// Metadata
// ============================================================================

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });

  const title = t("meta.title");
  const description = t("meta.description");

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const prefix = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${SITE_URL}${prefix}/blog`;
  }
  languages["x-default"] = `${SITE_URL}/blog`;

  const ogLocaleMap: Record<string, string> = { en: "en_US", es: "es_ES", it: "it_IT" };
  const ogLocale = ogLocaleMap[locale] ?? "en_US";
  const alternateLocale = Object.values(ogLocaleMap).filter((l) => l !== ogLocale);

  return {
    title,
    description,
    alternates: {
      canonical: languages[locale],
      languages,
    },
    openGraph: {
      title,
      description,
      url: languages[locale],
      siteName: "MonkeyTravel",
      locale: ogLocale,
      alternateLocale,
      type: "website",
      images: [
        {
          url: `${SITE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: "MonkeyTravel Blog",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${SITE_URL}/og-image.png`],
    },
  };
}

// ============================================================================
// Page
// ============================================================================

export default async function BlogIndexPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("blog");
  const posts = await getAllPosts(locale);
  const allFrontmatter = posts.map((p) => p.frontmatter);

  // Curation — pure heuristics so we don't need to flag posts in markdown.
  // Featured = newest post overall. Each lane = newest 3 posts in a category
  // bucket, with bucket membership selecting the lane's content.
  const featured: BlogFrontmatter | null = allFrontmatter[0] ?? null;
  const restOfPosts = allFrontmatter.slice(1);

  const byCategory = (cats: string[], limit: number, exclude: Set<string>): BlogFrontmatter[] =>
    restOfPosts
      .filter((p) => cats.includes(p.category) && !exclude.has(p.slug))
      .slice(0, limit);

  const usedSlugs = new Set<string>();
  const trendingLane = byCategory(["Destination Guides"], 3, usedSlugs);
  trendingLane.forEach((p) => usedSlugs.add(p.slug));
  const practicalLane = byCategory(["Trip Planning", "Travel Tips"], 3, usedSlugs);
  practicalLane.forEach((p) => usedSlugs.add(p.slug));
  const aiLane = byCategory(["AI Travel"], 3, usedSlugs);
  aiLane.forEach((p) => usedSlugs.add(p.slug));

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const blogUrl = `${SITE_URL}${localePrefix}/blog`;

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    { name: t("breadcrumbs.blog"), url: blogUrl },
  ]);

  const collectionSchema = generateCollectionPageSchema({
    name: t("index.title"),
    description: t("meta.description"),
    url: blogUrl,
    posts: posts.map((post) => ({
      url: `${blogUrl}/${post.frontmatter.slug}`,
      name: t(`posts.${post.frontmatter.slug}.title`),
    })),
  });

  return (
    <>
      <script {...jsonLdScriptProps([breadcrumbSchema, collectionSchema])} />

      <ContentTracker
        contentType="blog_index"
        contentId="blog"
        contentGroup="blog"
        metadata={{ total_posts: posts.length }}
      />
      <Navbar />

      <main className="pt-20">
        {/* Hero — compact magazine masthead */}
        <section className="relative py-12 sm:py-16 bg-gradient-to-b from-[var(--primary)]/5 via-white to-white border-b border-slate-200/60">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-2 text-sm text-slate-500 mb-4">
              <Link href="/" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.home")}
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-slate-700 font-medium">{t("breadcrumbs.blog")}</span>
            </nav>

            <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
              <div>
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 tracking-tight leading-tight">
                  {t("index.title")}
                </h1>
                <p className="mt-3 text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
                  {t("index.subtitle")}
                </p>
              </div>
              <p className="hidden md:block text-sm font-semibold uppercase tracking-wider text-[var(--primary)]">
                {posts.length}{" "}
                <span className="text-slate-400 font-normal normal-case tracking-normal">
                  {t("index.articleCount")}
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* Featured editor's pick */}
        {featured && (
          <section className="py-10 sm:py-12 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <FeaturedHero
                post={featured}
                title={t(`posts.${featured.slug}.title`)}
                description={t(`posts.${featured.slug}.description`)}
                category={t(`categories.${featured.category}`)}
                readMoreLabel={t("index.readMore")}
                minuteReadLabel={t("index.minuteRead", { minutes: featured.readingTime })}
                eyebrowLabel={t("index.featured")}
              />
            </div>
          </section>
        )}

        {/* Curated lanes */}
        <div className="bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 divide-y divide-slate-200/60">
            <BlogLane
              title={t("lanes.trending.title")}
              description={t("lanes.trending.description")}
              posts={trendingLane}
            />
            <BlogLane
              title={t("lanes.practical.title")}
              description={t("lanes.practical.description")}
              posts={practicalLane}
            />
            <BlogLane
              title={t("lanes.ai.title")}
              description={t("lanes.ai.description")}
              posts={aiLane}
            />
          </div>
        </div>

        {/* All posts — filterable grid */}
        <section className="py-14 sm:py-16 bg-[var(--background-alt)] border-t border-slate-200/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 tracking-tight">
              {t("index.allPostsHeading")}
            </h2>
            <p className="text-sm sm:text-base text-slate-500 mb-8">{t("index.allPostsDescription")}</p>
            <BlogGrid posts={allFrontmatter} />
          </div>
        </section>

        {/* Server-rendered link list — ensures every post is discoverable in
            the initial SSR HTML even though BlogGrid above is client-only.
            Visually hidden but accessible to crawlers and screen readers. */}
        <nav aria-label={t("index.allPostsLabel")} className="sr-only">
          <h2>{t("index.allPostsLabel")}</h2>
          <ul>
            {posts.map(({ frontmatter }) => (
              <li key={frontmatter.slug}>
                <Link href={`/blog/${frontmatter.slug}`}>
                  {t(`posts.${frontmatter.slug}.title`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <Footer />
    </>
  );
}
