import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";
import { destinations } from "@/lib/destinations/data";
import type { Locale } from "@/lib/destinations/types";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DestinationGrid } from "@/components/destinations";
import { Link } from "@/lib/i18n/routing";

const SITE_URL = "https://monkeytravel.app";

// Style tags surfaced as landing pages. Pulled from the destination data —
// these are the high-level vibe taxonomies, not activity-level tags.
const STYLE_TAGS = [
  "romantic", "cultural", "foodie", "urban", "historical",
  "beach", "nightlife", "adventure", "nature", "wellness",
  "shopping", "offbeat",
] as const;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    STYLE_TAGS.map((tag) => ({ locale, tag }))
  );
}

interface PageProps {
  params: Promise<{ locale: string; tag: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, tag } = await params;
  if (!STYLE_TAGS.includes(tag as (typeof STYLE_TAGS)[number])) return {};

  const t = await getTranslations({ locale, namespace: "destinations" });
  const matched = destinations.filter((d) => d.tags.includes(tag));
  if (matched.length === 0) return {};

  const tagLabel = t(`tags.${tag}`);
  const title = t("style.metaTitle", { tag: tagLabel });
  const description = t("style.metaDescription", { tag: tagLabel, count: matched.length });

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const prefix = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${SITE_URL}${prefix}/destinations/style/${tag}`;
  }
  languages["x-default"] = `${SITE_URL}/destinations/style/${tag}`;

  const ogLocaleMap: Record<string, string> = { en: "en_US", es: "es_ES", it: "it_IT" };
  const ogLocale = ogLocaleMap[locale] ?? "en_US";
  const alternateLocale = Object.values(ogLocaleMap).filter((l) => l !== ogLocale);

  return {
    title,
    description,
    alternates: { canonical: languages[locale], languages },
    openGraph: {
      title,
      description,
      url: languages[locale],
      siteName: "MonkeyTravel",
      type: "website",
      locale: ogLocale,
      alternateLocale,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DestinationStylePage({ params }: PageProps) {
  const { locale, tag } = await params;
  setRequestLocale(locale);

  if (!STYLE_TAGS.includes(tag as (typeof STYLE_TAGS)[number])) notFound();

  const matched = destinations.filter((d) => d.tags.includes(tag));
  if (matched.length === 0) notFound();

  const loc = locale as Locale;
  const t = await getTranslations("destinations");
  const tagLabel = t(`tags.${tag}`);
  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbs.home"), url: `${SITE_URL}${localePrefix}` },
    { name: t("breadcrumbs.destinations"), url: `${SITE_URL}${localePrefix}/destinations` },
    { name: tagLabel, url: `${SITE_URL}${localePrefix}/destinations/style/${tag}` },
  ]);

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumbSchema)} />

      <Navbar />

      <main className="pt-20">
        <section className="py-14 sm:py-16 bg-gradient-to-b from-[var(--primary)]/5 to-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-2 text-sm text-[var(--foreground-muted)] mb-6">
              <Link href="/" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.home")}
              </Link>
              <span>/</span>
              <Link href="/destinations" className="hover:text-[var(--primary)] transition-colors">
                {t("breadcrumbs.destinations")}
              </Link>
              <span>/</span>
              <span className="text-[var(--foreground)] font-medium">{tagLabel}</span>
            </nav>

            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--primary)] mb-2">
              {t("style.eyebrow")}
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
              {t("style.heading", { tag: tagLabel })}
            </h1>
            <p className="text-lg text-[var(--foreground-muted)] max-w-2xl">
              {t("style.subtitle", { count: matched.length })}
            </p>
          </div>
        </section>

        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <DestinationGrid
              destinations={matched}
              locale={loc}
              planTripLabel={t("cta.planTrip")}
              daysLabel={(days) => t("card.days", { days })}
              tagLabels={Object.fromEntries(
                ["romantic","cultural","foodie","urban","historical","beach","nightlife","adventure","nature","wellness","shopping","offbeat"].map(
                  (label) => [label, t(`tags.${label}`)]
                )
              )}
            />
          </div>
        </section>

        {/* SR-only nav — guaranteed crawl discoverability */}
        <nav aria-label={t("style.allDestinations")} className="sr-only">
          <h2>{t("style.allDestinations")}</h2>
          <ul>
            {matched.map((d) => (
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
