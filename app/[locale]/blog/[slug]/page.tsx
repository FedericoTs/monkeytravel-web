import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import { getAllSlugs, getPostBySlug, getRelatedPosts } from "@/lib/blog/api";
import {
  generateArticleSchema,
  generateBreadcrumbSchema,
  generateFAQSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { BlogContent, BlogCard } from "@/components/blog";
import { Link } from "@/lib/i18n/routing";

const SITE_URL = "https://monkeytravel.app";

// ============================================================================
// Static params — all slug × locale combinations
// ============================================================================

export function generateStaticParams() {
  const slugs = getAllSlugs();
  return slugs.flatMap((slug) =>
    routing.locales.map((locale) => ({ locale, slug }))
  );
}

// ============================================================================
// Metadata
// ============================================================================

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};

  const { frontmatter } = post;
  const title = frontmatter.seo.title;
  const description = frontmatter.seo.description;

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const prefix = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${SITE_URL}${prefix}/blog/${slug}`;
  }
  languages["x-default"] = `${SITE_URL}/blog/${slug}`;

  return {
    title,
    description,
    keywords: frontmatter.seo.keywords,
    alternates: {
      canonical: languages[locale],
      languages,
    },
    openGraph: {
      title,
      description,
      url: languages[locale],
      siteName: "MonkeyTravel",
      images: [frontmatter.image],
      type: "article",
      publishedTime: frontmatter.publishedAt,
      modifiedTime: frontmatter.updatedAt,
      authors: [frontmatter.author],
    },
  };
}

// ============================================================================
// FAQ extraction from markdown
// ============================================================================

function extractFAQs(html: string): { question: string; answer: string }[] {
  const faqs: { question: string; answer: string }[] = [];
  // Match FAQ section: everything after an <h2> containing "FAQ"
  const faqSectionMatch = html.match(
    /<h2[^>]*>.*?FAQ.*?<\/h2>([\s\S]*?)(?=<hr|$)/i
  );
  if (!faqSectionMatch) return faqs;

  const faqHtml = faqSectionMatch[1];
  // Match h3 questions followed by paragraph answers
  const questionRegex = /<h3[^>]*>(.*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = questionRegex.exec(faqHtml)) !== null) {
    faqs.push({
      question: match[1].replace(/<[^>]*>/g, "").trim(),
      answer: match[2].replace(/<[^>]*>/g, "").trim(),
    });
  }
  return faqs;
}

// ============================================================================
// Page
// ============================================================================

export default async function BlogDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const t = await getTranslations("blog");
  const { frontmatter, html } = post;

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const pageUrl = `${SITE_URL}${localePrefix}/blog/${slug}`;

  // Structured data
  const articleSchema = generateArticleSchema({
    title: frontmatter.title,
    description: frontmatter.description,
    url: pageUrl,
    image: frontmatter.image
      ? `${SITE_URL}${frontmatter.image}`
      : undefined,
    datePublished: frontmatter.publishedAt,
    dateModified: frontmatter.updatedAt,
    author: frontmatter.author,
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    { name: t("breadcrumbs.blog"), url: `${SITE_URL}${localePrefix}/blog` },
    { name: frontmatter.title, url: pageUrl },
  ]);

  const faqs = extractFAQs(html);
  const schemas: object[] = [articleSchema, breadcrumbSchema];
  if (faqs.length > 0) {
    schemas.push(generateFAQSchema(faqs));
  }

  const related = await getRelatedPosts(slug, 3);

  // Format date for display
  const publishedDate = new Date(frontmatter.publishedAt).toLocaleDateString(
    locale,
    { year: "numeric", month: "long", day: "numeric" }
  );
  const updatedDate =
    frontmatter.updatedAt !== frontmatter.publishedAt
      ? new Date(frontmatter.updatedAt).toLocaleDateString(locale, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

  return (
    <>
      <script {...jsonLdScriptProps(schemas)} />

      <Navbar />

      <main className="pt-20">
        {/* Breadcrumb */}
        <div className="bg-white pt-4 pb-0">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-2 text-sm text-[var(--foreground-muted)] py-3">
              <Link
                href="/"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("breadcrumbs.home")}
              </Link>
              <span>/</span>
              <Link
                href="/blog"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("breadcrumbs.blog")}
              </Link>
              <span>/</span>
              <span className="text-[var(--foreground)] font-medium truncate">
                {frontmatter.title}
              </span>
            </nav>
          </div>
        </div>

        {/* Article header */}
        <section className="py-8 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <span className="inline-block px-3 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium mb-4">
              {frontmatter.category}
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
              {frontmatter.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--foreground-muted)]">
              <span>{t("detail.publishedOn", { date: publishedDate })}</span>
              {updatedDate && (
                <span>{t("detail.updatedOn", { date: updatedDate })}</span>
              )}
              <span>
                {t("index.minuteRead", {
                  minutes: frontmatter.readingTime,
                })}
              </span>
            </div>
          </div>
        </section>

        {/* Featured image */}
        <section className="bg-white pb-8">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative w-full aspect-[1200/630] rounded-2xl overflow-hidden">
              <Image
                src={frontmatter.image}
                alt={frontmatter.imageAlt}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 768px"
                priority
              />
            </div>
          </div>
        </section>

        {/* Article body */}
        <section className="pb-16 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <BlogContent html={html} />
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-[var(--primary)]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              {t("detail.planYourTrip")}
            </h2>
            <p className="text-white/80 mb-8 max-w-xl mx-auto">
              {t("detail.planYourTripDescription")}
            </p>
            <a
              href="https://monkeytravel.app"
              className="inline-block px-8 py-3 rounded-full bg-[var(--accent)] text-[var(--foreground)] font-semibold hover:bg-[var(--accent)]/90 transition-colors"
            >
              {t("detail.planYourTripCta")}
            </a>
          </div>
        </section>

        {/* Related posts */}
        {related.length > 0 && (
          <section className="py-16 bg-[var(--background-alt)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-8 text-center">
                {t("detail.relatedPosts")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {related.map((relPost) => (
                  <BlogCard
                    key={relPost.frontmatter.slug}
                    post={relPost.frontmatter}
                    readMoreLabel={t("index.readMore")}
                    minuteReadLabel={t("index.minuteRead", {
                      minutes: relPost.frontmatter.readingTime,
                    })}
                  />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </>
  );
}
