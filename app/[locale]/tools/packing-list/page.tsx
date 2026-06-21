import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import PackingListClient from "./PackingListClient";
import {
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";

const BASE_URL = "https://monkeytravel.app";

const META: Record<string, { title: string; description: string }> = {
  pt: {
    title:
      "Gerador de Lista de Bagagem Grátis — Personalizada por IA",
    description:
      "Receba uma lista de bagagem personalizada em 10 segundos. Nossa IA considera o clima do destino, as tomadas locais e suas atividades. Grátis, sem cadastro.",
  },
  en: {
    title:
      "Free Packing List Generator — Personalized by AI for Any Trip",
    description:
      "Get a personalized packing list in 10 seconds. Our AI factors in destination weather, local outlets, and your planned activities. No signup, free forever.",
  },
  it: {
    title:
      "Generatore Liste Bagaglio Gratuito — Personalizzato dall'AI",
    description:
      "Ricevi una lista bagaglio personalizzata in 10 secondi. La nostra AI considera clima, prese elettriche e le tue attività. Gratis, senza registrazione.",
  },
  es: {
    title:
      "Generador Gratis de Lista de Equipaje — Personalizada por IA",
    description:
      "Recibe una lista de equipaje personalizada en 10 segundos. Nuestra IA considera el clima, los enchufes locales y tus actividades. Gratis, sin registro.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const m = META[locale] || META.en;
  const localePrefix = locale === "en" ? "" : `/${locale}`;
  const canonical = `${BASE_URL}${localePrefix}/tools/packing-list`;
  return {
    title: m.title,
    description: m.description,
    alternates: {
      canonical,
      languages: {
        en: `${BASE_URL}/tools/packing-list`,
        it: `${BASE_URL}/it/tools/packing-list`,
        es: `${BASE_URL}/es/tools/packing-list`,
        pt: `${BASE_URL}/pt/tools/packing-list`,
      },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      url: canonical,
      type: "website",
    },
  };
}

export default async function PackingListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools.packingList");
  const tToolsLanding = await getTranslations("tools.landing");
  const tBreadcrumbs = await getTranslations("breadcrumbs");

  const localePrefix = locale === "en" ? "" : `/${locale}`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: tBreadcrumbs("home"), url: BASE_URL },
    { name: tToolsLanding("breadcrumb"), url: `${BASE_URL}${localePrefix}/tools` },
    {
      name: t("breadcrumb"),
      url: `${BASE_URL}${localePrefix}/tools/packing-list`,
    },
  ]);

  const nonce = await getNonce();

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 sm:py-12 w-full">
        <nav className="text-sm text-slate-500 mb-4" aria-label="Breadcrumb">
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

        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">
          {t("h1")}
        </h1>
        <p className="text-lg text-slate-600 mb-8">{t("subtitle")}</p>

        <PackingListClient locale={locale} />
      </main>
      <Footer />
    </div>
  );
}
