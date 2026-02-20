import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import type { Locale } from "@/lib/destinations/types";
import { destinations, getDestinationBySlug, getAllSlugs, getRelatedDestinations, getDestinationsByTag } from "@/lib/destinations/data";
import { getBlogPostsForDestination } from "@/lib/cross-links";
import {
  generateTouristDestinationSchema,
  generateBreadcrumbSchema,
  generateFAQSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ContentTracker from "@/components/analytics/ContentTracker";
import {
  DestinationPageHero,
  BestTimeToVisit,
  DestinationHighlights,
  SampleDayPreview,
  DestinationFAQ,
  DestinationCTA,
  DestinationGrid,
} from "@/components/destinations";
import { Link } from "@/lib/i18n/routing";

const SITE_URL = "https://monkeytravel.app";

// ============================================================================
// Static params — generates all slug × locale combinations at build time
// ============================================================================

export function generateStaticParams() {
  const slugs = getAllSlugs();
  return slugs.flatMap((slug) =>
    routing.locales.map((locale) => ({ locale, slug }))
  );
}

// ============================================================================
// Metadata — SEO titles, descriptions, hreflang alternates
// ============================================================================

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const destination = getDestinationBySlug(slug);
  if (!destination) return {};

  const t = await getTranslations({ locale, namespace: "destinations" });
  const loc = locale as Locale;
  const cityName = destination.name[loc];
  const countryName = destination.country[loc];

  const title = t("meta.titleDetail", { city: cityName });
  const description = t("meta.descriptionDetail", {
    city: cityName,
    country: countryName,
  });

  // Build hreflang alternates
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const prefix = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${SITE_URL}${prefix}/destinations/${slug}`;
  }
  languages["x-default"] = `${SITE_URL}/destinations/${slug}`;

  return {
    title,
    description,
    keywords: [
      `${cityName} travel guide`,
      `${cityName} itinerary`,
      `things to do in ${cityName}`,
      `${cityName} trip planner`,
      `AI itinerary ${cityName}`,
      `best time to visit ${cityName}`,
    ],
    alternates: {
      canonical: languages[locale],
      languages,
    },
    openGraph: {
      title,
      description,
      url: languages[locale],
      siteName: "MonkeyTravel",
      images: [`/images/destinations/${slug}.jpg`],
      type: "website",
    },
  };
}

// ============================================================================
// Page component
// ============================================================================

export default async function DestinationDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const destination = getDestinationBySlug(slug);
  if (!destination) notFound();

  const loc = locale as Locale;
  const t = await getTranslations("destinations");
  const tBlog = await getTranslations("blog");
  const cityName = destination.name[loc];

  // Structured data
  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const pageUrl = `${SITE_URL}${localePrefix}/destinations/${slug}`;

  const touristSchema = generateTouristDestinationSchema({
    name: cityName,
    description: destination.content.description[loc],
    url: pageUrl,
    latitude: destination.coordinates.lat,
    longitude: destination.coordinates.lng,
    countryName: destination.country[loc],
    image: `${SITE_URL}/images/destinations/${slug}.jpg`,
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    {
      name: t("breadcrumbs.destinations"),
      url: `${SITE_URL}${localePrefix}/destinations`,
    },
    { name: cityName, url: pageUrl },
  ]);

  const faqSchema = generateFAQSchema(
    destination.content.faqs.map((faq) => ({
      question: faq.question[loc],
      answer: faq.answer[loc],
    }))
  );

  const relatedDestinations = getRelatedDestinations(slug, 6);
  const relatedBlogSlugs = getBlogPostsForDestination(slug, 3);

  // Get tag-based destination links (first 2 tags that have other destinations)
  const tagLinks = destination.tags
    .map((tag) => ({
      tag,
      destinations: getDestinationsByTag(tag, slug, 4),
    }))
    .filter((tl) => tl.destinations.length >= 2)
    .slice(0, 2);

  return (
    <>
      <script {...jsonLdScriptProps([touristSchema, breadcrumbSchema, faqSchema])} />

      <ContentTracker
        contentType="destination"
        contentId={slug}
        contentGroup="destinations"
        metadata={{
          continent: destination.continent,
          country: destination.country[loc],
          budget_level: destination.stats.budgetLevel,
        }}
      />
      <Navbar />

      <main>
        {/* Breadcrumbs */}
        <div className="bg-white pt-20 pb-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-2 text-sm text-[var(--foreground-muted)] py-3">
              <Link
                href="/"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("breadcrumbs.home")}
              </Link>
              <span>/</span>
              <Link
                href="/destinations"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("breadcrumbs.destinations")}
              </Link>
              <span>/</span>
              <span className="text-[var(--foreground)] font-medium">
                {cityName}
              </span>
            </nav>
          </div>
        </div>

        {/* Hero */}
        <DestinationPageHero destination={destination} locale={loc} t={t} />

        {/* Description */}
        <section className="py-16 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-lg text-[var(--foreground-muted)] leading-relaxed">
              {destination.content.description[loc]}
            </p>
          </div>
        </section>

        {/* Best Time to Visit */}
        <BestTimeToVisit destination={destination} locale={loc} t={t} />

        {/* Why Visit */}
        <DestinationHighlights
          cityName={cityName}
          highlights={destination.content.highlights}
          locale={loc}
          t={t}
        />

        {/* Sample Day */}
        <SampleDayPreview
          cityName={cityName}
          activities={destination.content.sampleDay.activities}
          locale={loc}
          t={t}
        />

        {/* FAQ */}
        <DestinationFAQ
          faqs={destination.content.faqs}
          locale={loc}
          t={t}
        />

        {/* CTA */}
        <DestinationCTA
          slug={slug}
          ctaText={destination.content.ctaText[loc]}
          cityName={cityName}
          locale={loc}
          t={t}
        />

        {/* Related Blog Posts */}
        {relatedBlogSlugs.length > 0 && (
          <section className="py-16 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-8 text-center">
                {t("sections.relatedArticles")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {relatedBlogSlugs.map((blogSlug) => (
                  <Link
                    key={blogSlug}
                    href={`/blog/${blogSlug}`}
                    className="group block rounded-xl border border-gray-100 hover:border-[var(--accent)]/30 hover:shadow-lg transition-all p-6 bg-white"
                  >
                    <span className="text-sm font-medium text-[var(--primary)] mb-2 block">
                      Blog
                    </span>
                    <h3 className="text-lg font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors leading-snug">
                      {tBlog(`posts.${blogSlug}.title`)}
                    </h3>
                    <span className="mt-3 text-sm text-[var(--primary)] font-medium inline-flex items-center gap-1">
                      {tBlog("index.readMore")} →
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Explore by Travel Style */}
        {tagLinks.length > 0 && (
          <section className="py-12 bg-[var(--background-alt)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {tagLinks.map((tl) => (
                <div key={tl.tag} className="mb-10 last:mb-0">
                  <h3 className="text-xl font-bold text-[var(--foreground)] mb-5">
                    {t("sections.exploreByStyle", { tag: t(`tags.${tl.tag}`) })}
                  </h3>
                  <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
                    {tl.destinations.map((dest) => (
                      <Link
                        key={dest.slug}
                        href={`/destinations/${dest.slug}`}
                        className="flex-shrink-0 group flex items-center gap-3 rounded-full border border-gray-200 hover:border-[var(--accent)] bg-white px-5 py-2.5 transition-all hover:shadow-md"
                      >
                        <span className="text-sm font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors">
                          {dest.name[loc]}
                        </span>
                        <span className="text-xs text-[var(--foreground-muted)]">
                          {dest.country[loc]}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* More Destinations */}
        {relatedDestinations.length > 0 && (
          <section className="py-16 bg-[var(--background-alt)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-3xl font-bold text-[var(--foreground)] mb-8 text-center">
                {t("sections.moreDestinations")}
              </h2>
              <DestinationGrid
                destinations={relatedDestinations}
                locale={loc}
                planTripLabel={t("cta.planTrip")}
                daysLabel={(days) => t("card.days", { days })}
                tagLabels={Object.fromEntries(
                  ["romantic","cultural","foodie","urban","historical","beach","nightlife","adventure","nature","wellness","shopping","offbeat"].map(
                    (tag) => [tag, t(`tags.${tag}`)]
                  )
                )}
              />
            </div>
          </section>
        )}
      </main>

      <Footer />
    </>
  );
}
