import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import type { Locale } from "@/lib/destinations/types";
import { destinations } from "@/lib/destinations/data";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ContentTracker from "@/components/analytics/ContentTracker";
import { DestinationGrid, DestinationFeatured, DestinationLane } from "@/components/destinations";
import { Link } from "@/lib/i18n/routing";

const SITE_URL = "https://monkeytravel.app";

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
  const t = await getTranslations({ locale, namespace: "destinations" });

  const title = t("meta.titleIndex");
  const description = t("meta.descriptionIndex");

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const prefix = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${SITE_URL}${prefix}/destinations`;
  }
  languages["x-default"] = `${SITE_URL}/destinations`;

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
    },
  };
}

// ============================================================================
// Page
// ============================================================================

export default async function DestinationsIndexPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const loc = locale as Locale;
  const t = await getTranslations("destinations");

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    {
      name: t("breadcrumbs.destinations"),
      url: `${SITE_URL}${localePrefix}/destinations`,
    },
  ]);

  // Group by continent for display
  const continents = [...new Set(destinations.map((d) => d.continent))];

  // Curation — pure heuristics, no manual flagging required.
  const featured = destinations[0]; // Paris currently
  const usedSlugs = new Set<string>([featured.slug]);
  const pickByTag = (tag: string, limit: number): typeof destinations => {
    const picks = destinations
      .filter((d) => d.tags.includes(tag) && !usedSlugs.has(d.slug))
      .slice(0, limit);
    picks.forEach((d) => usedSlugs.add(d.slug));
    return picks;
  };
  const trendingLane = pickByTag("urban", 3);
  const romanticLane = pickByTag("romantic", 3);
  const beachLane = pickByTag("beach", 3);

  // Translation tag-label map reused across all grids
  const tagLabels = Object.fromEntries(
    ["romantic","cultural","foodie","urban","historical","beach","nightlife","adventure","nature","wellness","shopping","offbeat"].map(
      (tag) => [tag, t(`tags.${tag}`)]
    )
  );

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumbSchema)} />

      <ContentTracker
        contentType="destination_index"
        contentId="destinations"
        contentGroup="destinations"
        metadata={{ total_destinations: destinations.length }}
      />
      <Navbar />

      <main className="pt-20">
        {/* Compact magazine masthead */}
        <section className="relative py-12 sm:py-16 bg-gradient-to-b from-[var(--primary)]/5 via-white to-white border-b border-slate-200/60">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-2 text-sm text-slate-500 mb-4">
              <Link href="/" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.home")}
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-slate-700 font-medium">{t("breadcrumbs.destinations")}</span>
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
                {destinations.length}{" "}
                <span className="text-slate-400 font-normal normal-case tracking-normal">
                  {t("index.destinationCount")}
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* Featured destination */}
        {featured && (
          <section className="py-10 sm:py-12 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <DestinationFeatured
                destination={featured}
                locale={loc}
                eyebrowLabel={t("index.featured")}
                ctaLabel={t("cta.planTrip")}
                daysLabel={t("card.days", { days: featured.stats.avgStayDays })}
              />
            </div>
          </section>
        )}

        {/* Curated style lanes */}
        <div className="bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 divide-y divide-slate-200/60">
            <DestinationLane
              title={t("lanes.trending.title")}
              description={t("lanes.trending.description")}
              destinations={trendingLane}
              locale={loc}
              planTripLabel={t("cta.planTrip")}
              daysLabel={(days) => t("card.days", { days })}
              tagLabels={tagLabels}
              viewAllHref="/destinations/style/urban"
              viewAllLabel={t("lanes.viewAll")}
            />
            <DestinationLane
              title={t("lanes.romantic.title")}
              description={t("lanes.romantic.description")}
              destinations={romanticLane}
              locale={loc}
              planTripLabel={t("cta.planTrip")}
              daysLabel={(days) => t("card.days", { days })}
              tagLabels={tagLabels}
              viewAllHref="/destinations/style/romantic"
              viewAllLabel={t("lanes.viewAll")}
            />
            <DestinationLane
              title={t("lanes.beach.title")}
              description={t("lanes.beach.description")}
              destinations={beachLane}
              locale={loc}
              planTripLabel={t("cta.planTrip")}
              daysLabel={(days) => t("card.days", { days })}
              tagLabels={tagLabels}
              viewAllHref="/destinations/style/beach"
              viewAllLabel={t("lanes.viewAll")}
            />
          </div>
        </div>

        {/* All destinations grouped by continent */}
        <section className="py-14 sm:py-16 bg-[var(--background-alt)] border-t border-slate-200/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 tracking-tight">
              {t("index.allByContinent")}
            </h2>
            <p className="text-sm sm:text-base text-slate-500 mb-10">{t("index.allByContinentDescription")}</p>

            {continents.map((continent) => {
              const continentDestinations = destinations.filter(
                (d) => d.continent === continent
              );

              return (
                <div key={continent} className="mt-12 first:mt-0">
                  <h3 className="text-xl font-bold text-slate-900 mb-6">
                    {t(`continents.${continent}`)}
                  </h3>
                  <DestinationGrid
                    destinations={continentDestinations}
                    locale={loc}
                    planTripLabel={t("cta.planTrip")}
                    daysLabel={(days) => t("card.days", { days })}
                    tagLabels={tagLabels}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Server-rendered link list — guarantees every destination is
            discoverable in initial SSR HTML even if RSC streaming hides
            the visible grid from Googlebot's first-pass crawl. */}
        <nav aria-label={t("index.allDestinations")} className="sr-only">
          <h2>{t("index.allDestinations")}</h2>
          <ul>
            {destinations.map((d) => (
              <li key={d.slug}>
                <Link href={`/destinations/${d.slug}`}>
                  {d.name[loc]}, {d.country[loc]}
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
