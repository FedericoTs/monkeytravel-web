import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";

const BASE_URL = "https://monkeytravel.app";

const META: Record<string, { title: string; description: string }> = {
  en: {
    title: "Free Travel Tools — Packing List, Visa Checker & More",
    description:
      "Free travel tools that save you hours of trip planning. AI-personalized packing list, visa requirements, and more. No signup required.",
  },
  it: {
    title:
      "Strumenti di Viaggio Gratuiti — Lista Bagaglio, Verifica Visto e Altro",
    description:
      "Strumenti gratuiti che ti fanno risparmiare ore di pianificazione. Lista bagaglio personalizzata con AI, requisiti visa e altro. Senza registrazione.",
  },
  es: {
    title:
      "Herramientas de Viaje Gratis — Lista de Equipaje, Verificador de Visa y Más",
    description:
      "Herramientas gratuitas que te ahorran horas de planificación. Lista de equipaje con IA, requisitos de visa y más. Sin registro.",
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
  const canonical = `${BASE_URL}${localePrefix}/tools`;
  return {
    title: m.title,
    description: m.description,
    alternates: {
      canonical,
      languages: {
        en: `${BASE_URL}/tools`,
        it: `${BASE_URL}/it/tools`,
        es: `${BASE_URL}/es/tools`,
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

export default async function ToolsLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools.landing");

  const tools = [
    {
      slug: "packing-list",
      icon: "🧳",
      title:
        locale === "it"
          ? "Generatore Lista Bagaglio"
          : locale === "es"
            ? "Generador de Lista de Equipaje"
            : "Packing List Generator",
      description:
        locale === "it"
          ? "Lista personalizzata con AI in base a destinazione, clima e attività."
          : locale === "es"
            ? "Lista personalizada con IA según destino, clima y actividades."
            : "AI-personalized list based on destination, weather, and activities.",
      live: true,
    },
    {
      slug: "visa-checker",
      icon: "🛂",
      title:
        locale === "it"
          ? "Verifica Requisiti Visto"
          : locale === "es"
            ? "Verificador de Visa"
            : "Visa Requirements Checker",
      description:
        locale === "it"
          ? "Scopri in pochi secondi se ti serve un visto."
          : locale === "es"
            ? "Descubre en segundos si necesitas visa."
            : "Find out in seconds whether you need a visa.",
      live: true,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-12 sm:py-16 w-full">
        <nav className="text-sm text-slate-500 mb-6" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-slate-700">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{t("breadcrumb")}</span>
        </nav>

        <h1 className="text-3xl sm:text-5xl font-bold text-slate-900 mb-3 tracking-tight">
          {t("title")}
        </h1>
        <p className="text-lg text-slate-600 mb-10 max-w-2xl">{t("subtitle")}</p>

        <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
          {tools.map((tool) => {
            const card = (
              <div
                className={`group relative rounded-2xl border p-6 sm:p-8 transition-all ${
                  tool.live
                    ? "border-slate-200 hover:border-[var(--primary)] hover:shadow-lg bg-white"
                    : "border-slate-200 bg-slate-50 opacity-75"
                }`}
              >
                <div className="text-4xl mb-4">{tool.icon}</div>
                <h2 className="text-xl font-semibold text-slate-900 mb-2">
                  {tool.title}
                </h2>
                <p className="text-slate-600 text-sm mb-4">{tool.description}</p>
                {tool.live ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)]">
                    {locale === "it" ? "Provalo →" : locale === "es" ? "Pruébalo →" : "Try it →"}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-slate-200 text-slate-700 rounded-full">
                    {t("comingSoon")}
                  </span>
                )}
              </div>
            );
            return tool.live ? (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className="block"
              >
                {card}
              </Link>
            ) : (
              <div key={tool.slug}>{card}</div>
            );
          })}
        </div>
      </main>
      <Footer />
    </div>
  );
}
