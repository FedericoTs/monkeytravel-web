import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import { getAllPosts } from "@/lib/blog/api";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { BlogCard } from "@/components/blog";
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
  const posts = await getAllPosts();

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    { name: t("breadcrumbs.blog"), url: `${SITE_URL}${localePrefix}/blog` },
  ]);

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumbSchema)} />

      <Navbar />

      <main className="pt-20">
        {/* Hero */}
        <section className="py-16 bg-gradient-to-b from-[var(--primary)]/5 to-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            {/* Breadcrumb */}
            <nav className="flex items-center justify-center gap-2 text-sm text-[var(--foreground-muted)] mb-8">
              <Link
                href="/"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("breadcrumbs.home")}
              </Link>
              <span>/</span>
              <span className="text-[var(--foreground)] font-medium">
                {t("breadcrumbs.blog")}
              </span>
            </nav>

            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
              {t("index.title")}
            </h1>
            <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
              {t("index.subtitle")}
            </p>
          </div>
        </section>

        {/* Post grid */}
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post) => (
                <BlogCard
                  key={post.frontmatter.slug}
                  post={post.frontmatter}
                  title={t(`posts.${post.frontmatter.slug}.title`)}
                  description={t(`posts.${post.frontmatter.slug}.description`)}
                  category={t(`categories.${post.frontmatter.category}`)}
                  readMoreLabel={t("index.readMore")}
                  minuteReadLabel={t("index.minuteRead", {
                    minutes: post.frontmatter.readingTime,
                  })}
                />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
