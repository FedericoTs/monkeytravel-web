import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import EmailSubscribe from "@/components/EmailSubscribe";
import { Link } from "@/lib/i18n/routing";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";

const BASE_URL = "https://monkeytravel.app";

const META: Record<string, { title: string; description: string }> = {
  en: {
    title:
      "Visa Requirements Checker — Coming Soon",
    description:
      "Find out in seconds whether you need a visa for your next trip. Free tool covering 30+ passports. Sign up to be notified at launch.",
  },
  it: {
    title:
      "Verifica Requisiti Visto — In Arrivo",
    description:
      "Scopri in pochi secondi se ti serve un visto per il tuo prossimo viaggio. Strumento gratuito per oltre 30 passaporti. Iscriviti per essere avvisato al lancio.",
  },
  es: {
    title:
      "Verificador de Visa — Próximamente",
    description:
      "Descubre en segundos si necesitas visa para tu próximo viaje. Herramienta gratuita para más de 30 pasaportes. Suscríbete para ser avisado en el lanzamiento.",
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
  const canonical = `${BASE_URL}${localePrefix}/tools/visa-checker`;
  return {
    title: m.title,
    description: m.description,
    alternates: {
      canonical,
      languages: {
        en: `${BASE_URL}/tools/visa-checker`,
        it: `${BASE_URL}/it/tools/visa-checker`,
        es: `${BASE_URL}/es/tools/visa-checker`,
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

export default async function VisaCheckerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools.visaChecker");
  const tToolsLanding = await getTranslations("tools.landing");

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-12 sm:py-16 w-full">
        <nav className="text-sm text-slate-500 mb-6" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-slate-700">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href="/tools" className="hover:text-slate-700">
            {tToolsLanding("breadcrumb")}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{t("breadcrumb")}</span>
        </nav>

        <div className="text-center sm:text-left">
          <div className="text-6xl mb-4">🛂</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">
            {t("h1")}
          </h1>
          <p className="text-lg text-slate-600 mb-8">{t("subtitle")}</p>
        </div>

        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6 sm:p-8 mb-8">
          <p className="text-amber-900 text-base mb-5">{t("comingSoonBanner")}</p>
          <EmailSubscribe source="visa_checker_waitlist" />
        </div>

        <div className="border-t border-slate-200 pt-8">
          <Link
            href="/tools/packing-list"
            className="inline-flex items-center gap-2 text-[var(--primary)] hover:underline font-medium"
          >
            🧳 {locale === "it"
              ? "Mentre aspetti — prova il Generatore Lista Bagaglio"
              : locale === "es"
                ? "Mientras esperas — prueba el Generador de Lista de Equipaje"
                : "While you wait — try the Packing List Generator"}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
