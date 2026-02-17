import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import type { Locale } from "@/lib/destinations/types";
import { destinations } from "@/lib/destinations/data";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DestinationGrid } from "@/components/destinations";
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
                {t("breadcrumbs.destinations")}
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

        {/* Destination grid by continent */}
        {continents.map((continent) => {
          const continentDestinations = destinations.filter(
            (d) => d.continent === continent
          );

          return (
            <section key={continent} className="py-12 bg-white">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <h2 className="text-2xl font-bold text-[var(--foreground)] mb-8">
                  {t(`continents.${continent}`)}
                </h2>
                <DestinationGrid
                  destinations={continentDestinations}
                  locale={loc}
                  planTripLabel={t("cta.planTrip")}
                />
              </div>
            </section>
          );
        })}
      </main>

      <Footer />
    </>
  );
}
