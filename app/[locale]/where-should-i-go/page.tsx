import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Footer from "@/components/Footer";
import MatchQuiz, { type QuizCopy } from "@/components/match/MatchQuiz";
import type { Locale } from "@/lib/destinations/types";
import { Link } from "@/lib/i18n/routing";
import { matchDestinations } from "@/lib/match/places";
import { QUESTIONS, homeFromContinent, parseCompanions } from "@/lib/match/questions";
import { buildAlternates, SITE_URL } from "@/lib/seo/canonical";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";

const PAGE_PATH = "/where-should-i-go";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "match" });
  const alternates = buildAlternates(PAGE_PATH, { locale });
  const image = `${SITE_URL}/api/og/match?locale=${locale}`;
  return {
    title: { absolute: t("meta.title") },
    description: t("meta.description"),
    alternates,
    openGraph: {
      siteName: "MonkeyTravel",
      title: t("meta.title"),
      description: t("meta.description"),
      url: alternates.canonical,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: t("start.title") }],
    },
    twitter: { card: "summary_large_image", title: t("meta.title"), description: t("meta.description"), images: [image] },
  };
}

export default async function WhereShouldIGoPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ with?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("match");
  const tBreadcrumbs = await getTranslations("common.breadcrumbs");
  const { with: rawWith } = await searchParams;
  const requestHeaders = await headers();

  const copy: QuizCopy = {
    brand: "MonkeyTravel",
    title: t("start.title"),
    subtitle: t("start.subtitle"),
    cta: t("start.cta"),
    note: t("start.note"),
    withFriend: t("start.withFriend"),
    progress: t.raw("quiz.progress") as string,
    back: t("quiz.back"),
    matching: t("quiz.matching"),
    questions: QUESTIONS.map((question) => ({
      title: t(`q.${question.id}.title`),
      options: question.options.map((option) => t(`q.${question.id}.options.${option}`)),
    })),
  };

  const places = matchDestinations();
  const prefix = locale === "en" ? "" : `/${locale}`;
  const breadcrumb = generateBreadcrumbSchema([
    { name: tBreadcrumbs("home"), url: SITE_URL },
    { name: t("page.breadcrumb"), url: `${SITE_URL}${prefix}${PAGE_PATH}` },
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)]">
      <script {...jsonLdScriptProps(breadcrumb)} />
      <main className="flex-1">
        <MatchQuiz copy={copy} home={homeFromContinent(requestHeaders.get("x-vercel-ip-continent"))} companions={parseCompanions(rawWith)} />

        <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">{t("page.howTitle")}</h2>
          <ol className="mt-6 flex flex-col gap-4 text-lg text-[var(--foreground)]">
            <li>{t("page.how1")}</li>
            <li>{t("page.how2", { count: places.length })}</li>
            <li>{t("page.how3")}</li>
          </ol>

          <h2 className="mt-14 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">{t("page.placesTitle")}</h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {places.map((place) => (
              <li key={place.slug}>
                <Link
                  href={`/destinations/${place.slug}`}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--foreground)]/[0.06] px-4 text-base text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)]/[0.1]"
                >
                  {place.name[locale as Locale]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <Footer />
    </div>
  );
}
