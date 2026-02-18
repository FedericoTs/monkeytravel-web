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
  const post = await getPostBySlug(slug, locale);
  if (!post) return {};

  const { frontmatter } = post;
  const t = await getTranslations({ locale, namespace: "blog" });
  const title = t(`posts.${slug}.title`);
  const description = t(`posts.${slug}.description`);

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

  const post = await getPostBySlug(slug, locale);
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

  const related = await getRelatedPosts(slug, 3, locale);

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
        {/* Hero — full-bleed image with overlay */}
        <section className="relative h-[340px] sm:h-[400px] md:h-[460px] overflow-hidden">
          {/* Background image */}
          <Image
            src={frontmatter.image}
            alt={frontmatter.imageAlt}
            fill
            className="object-cover"
            sizes="100vw"
            priority
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/20" />

          {/* Content overlay */}
          <div className="absolute inset-0 flex flex-col justify-end">
            <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-8 sm:pb-10">
              {/* Breadcrumb */}
              <nav className="flex items-center gap-2 text-sm text-white/60 mb-4">
                <Link
                  href="/"
                  className="hover:text-white transition-colors"
                >
                  {t("breadcrumbs.home")}
                </Link>
                <span className="text-white/40">/</span>
                <Link
                  href="/blog"
                  className="hover:text-white transition-colors"
                >
                  {t("breadcrumbs.blog")}
                </Link>
                <span className="text-white/40">/</span>
                <span className="text-white/80 truncate max-w-[200px] sm:max-w-none">
                  {t(`posts.${slug}.title`)}
                </span>
              </nav>

              {/* Category badge */}
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-white text-xs font-medium border border-white/20 mb-3">
                {t(`categories.${frontmatter.category}`)}
              </span>

              {/* Title */}
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight drop-shadow-lg leading-tight">
                {t(`posts.${slug}.title`)}
              </h1>

              {/* Meta chips */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-white/90 text-xs sm:text-sm border border-white/10">
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {publishedDate}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-white/90 text-xs sm:text-sm border border-white/10">
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t("index.minuteRead", { minutes: frontmatter.readingTime })}
                </span>
                {updatedDate && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)]/90 text-slate-900 text-xs sm:text-sm font-medium">
                    {t("detail.updatedOn", { date: updatedDate })}
                  </span>
                )}
              </div>
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
        <section className="relative py-20 overflow-hidden bg-[var(--primary)]">
          {/* Background decorations */}
          <div className="absolute inset-0 bg-grid-pattern opacity-40" />
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-[var(--accent)]/10 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-white/5 blur-3xl" />

          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            {/* Icon */}
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 mb-6">
              <svg className="w-7 h-7 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </div>

            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
              {t("detail.planYourTrip")}
            </h2>
            <p className="text-white/70 mb-10 max-w-xl mx-auto text-lg leading-relaxed">
              {t("detail.planYourTripDescription")}
            </p>
            <a
              href="https://monkeytravel.app"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-[var(--accent)] text-[var(--foreground)] font-semibold hover:bg-[var(--accent)]/90 transition-all hover:shadow-lg hover:shadow-[var(--accent)]/20 hover:-translate-y-0.5"
            >
              {t("detail.planYourTripCta")}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
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
                    title={t(`posts.${relPost.frontmatter.slug}.title`)}
                    description={t(`posts.${relPost.frontmatter.slug}.description`)}
                    category={t(`categories.${relPost.frontmatter.category}`)}
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
