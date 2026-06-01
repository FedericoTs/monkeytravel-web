import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import type { Locale } from "@/lib/destinations/types";
import { destinations } from "@/lib/destinations/data";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";
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

  const nonce = await getNonce();

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />

      <ContentTracker
        contentType="destination_index"
        contentId="destinations"
        contentGroup="destinations"
        metadata={{ total_destinations: destinations.length }}
      />
      <Navbar />

      <main className="pt-20">
        {/*
          Hero — 2026-05-31 redesign (task #355) to match the homepage +
          /explore visual language. Replaced the flat soft-pink masthead
          with: warm cream/rose/amber gradient background, three blurred
          decorative blobs (primary + accent + rose tints), a destination-
          count pill badge with map-pin icon, an accent-colored gradient
          headline (last phrase gets the coral-to-amber clip-text), a
          rich-text subtitle with bolded value-prop, and a trust-signal
          row mirroring the homepage/explore pattern.

          Stays SSR (no client component needed) — leans on Tailwind +
          next-intl rich text for the bold highlight.
        */}
        <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-rose-50 to-amber-50 border-b border-slate-200/60">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 -left-24 w-80 h-80 rounded-full bg-[var(--primary)]/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-40 -right-16 w-[28rem] h-[28rem] rounded-full bg-[var(--accent)]/25 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/3 w-64 h-64 rounded-full bg-rose-200/30 blur-3xl"
          />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 lg:py-24">
            <nav className="flex items-center gap-2 text-sm text-slate-600 mb-6">
              <Link href="/" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.home")}
              </Link>
              <span className="text-slate-400">/</span>
              <span className="text-slate-900 font-medium">{t("breadcrumbs.destinations")}</span>
            </nav>

            <div className="max-w-3xl">
              {/* Pill badge — uses the same map-pin icon idiom as the
                  destination cards, with the live destination count so
                  visitors see scale immediately. */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-[var(--primary)]/20 mb-6 shadow-sm">
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 text-[var(--primary)]"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm font-medium text-slate-700">
                  {destinations.length} {t("index.destinationCount")}
                </span>
              </div>

              {/* Headline — final phrase wraps in a gradient accent span
                  echoing the homepage + /explore hero treatment. */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 mb-5 leading-[1.1]">
                {t("index.heroLine1")}{" "}
                <span className="bg-gradient-to-r from-[var(--primary)] via-rose-500 to-orange-400 bg-clip-text text-transparent">
                  {t("index.heroLine2Accent")}
                </span>
              </h1>

              {/* Subtitle — next-intl rich text turns <b>…</b> chunks
                  into a bolded slate-900 span so the key value-prop pops. */}
              <p className="text-slate-600 text-base sm:text-lg max-w-2xl leading-relaxed mb-7">
                {t.rich("index.heroSubtitle", {
                  b: (chunks) => (
                    <strong className="text-slate-900 font-semibold">
                      {chunks}
                    </strong>
                  ),
                })}
              </p>

              {/* Trust signals — three short pills with check icons,
                  same visual rhythm as the homepage / explore hero. */}
              <ul className="flex flex-wrap items-center gap-x-6 gap-y-2.5 list-none">
                {[
                  t("index.trustCurated"),
                  t("index.trustAi"),
                  t("index.trustFree"),
                ].map((label) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-2 text-sm text-slate-700"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-4 h-4 text-emerald-500 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="font-medium">{label}</span>
                  </li>
                ))}
              </ul>
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
