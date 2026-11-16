import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import CheckPlanClient from "./CheckPlanClient";
import { generateBreadcrumbSchema, jsonLdScriptProps } from "@/lib/seo/structured-data";
import { ogImages } from "@/lib/seo/og-image";
import { buildAlternates, SITE_URL } from "@/lib/seo/canonical";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.checkPlan" });
  const alternates = buildAlternates("/tools/check-my-plan", { locale });
  return {
    // `absolute` opts out of the root "%s | MonkeyTravel" template.
    title: { absolute: t("metaTitle") },
    description: t("metaDescription"),
    alternates,
    openGraph: {
      siteName: "MonkeyTravel",
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: alternates.canonical,
      type: "website",
      images: ogImages(t("metaTitle")),
    },
  };
}

export default async function CheckMyPlanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools.checkPlan");
  const tToolsLanding = await getTranslations("tools.landing");
  const tBreadcrumbs = await getTranslations("common.breadcrumbs");
  const tA11y = await getTranslations("common.a11y");

  const localePrefix = locale === "en" ? "" : `/${locale}`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: tBreadcrumbs("home"), url: SITE_URL },
    { name: tToolsLanding("breadcrumb"), url: `${SITE_URL}${localePrefix}/tools` },
    { name: t("breadcrumb"), url: `${SITE_URL}${localePrefix}/tools/check-my-plan` },
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <script {...jsonLdScriptProps(breadcrumbSchema)} />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 sm:py-12 w-full">
        <nav className="text-sm text-slate-500 mb-4" aria-label={tA11y("breadcrumb")}>
          <Link href="/" className="hover:text-slate-700">
            {tBreadcrumbs("home")}
          </Link>
          <span className="mx-2">/</span>
          <Link href="/tools" className="hover:text-slate-700">
            {tToolsLanding("breadcrumb")}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{t("breadcrumb")}</span>
        </nav>

        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">{t("h1")}</h1>
        <p className="text-lg text-slate-600 mb-8">{t("subtitle")}</p>

        <CheckPlanClient />
      </main>
      <Footer />
    </div>
  );
}
