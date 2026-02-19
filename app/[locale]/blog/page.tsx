import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import { getAllPosts } from "@/lib/blog/api";
import { generateBreadcrumbSchema, generateCollectionPageSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BlogGrid from "@/components/blog/BlogGrid";
import { Link } from "@/lib/i18n/routing";

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

      <Navbar />

      <main className="pt-20">
        {/* Hero */}
        <section className="relative py-20 sm:py-24 overflow-hidden bg-[var(--primary)]">
          {/* Background decorations */}
          <div className="absolute inset-0 bg-grid-pattern opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--primary)]" />
          {/* Decorative blobs */}
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[var(--accent)]/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-white/5 blur-3xl" />

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            {/* Breadcrumb */}
            <nav className="flex items-center justify-center gap-2 text-sm text-white/60 mb-8">
              <Link
                href="/"
                className="hover:text-white transition-colors"
              >
                {t("breadcrumbs.home")}
              </Link>
              <span className="text-white/30">/</span>
              <span className="text-white/90 font-medium">
                {t("breadcrumbs.blog")}
              </span>
            </nav>

            {/* Icon badge */}
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 mb-6">
              <svg className="w-7 h-7 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-5 tracking-tight leading-tight">
              {t("index.title")}
            </h1>
            <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
              {t("index.subtitle")}
            </p>
          </div>
        </section>

        {/* Post grid with filtering and pagination */}
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <BlogGrid posts={posts.map((p) => p.frontmatter)} />
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
