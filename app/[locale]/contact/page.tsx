import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ContactForm from "@/components/contact/ContactForm";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact.meta" });
  const path = locale === "en" ? "/contact" : `/${locale}/contact`;
  const baseUrl = "https://monkeytravel.app";
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${baseUrl}${path}`,
      languages: {
        en: `${baseUrl}/contact`,
        es: `${baseUrl}/es/contact`,
        it: `${baseUrl}/it/contact`,
        "x-default": `${baseUrl}/contact`,
      },
    },
    robots: { index: true, follow: true },
  };
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--primary)] mb-3">
            {t("hero.eyebrow")}
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            {t("hero.title")}
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">{t("hero.subtitle")}</p>
        </div>

        <div className="rounded-3xl bg-white border border-slate-200 p-6 sm:p-10 shadow-sm">
          <ContactForm />
        </div>

        <p className="mt-8 text-center text-sm text-slate-500">
          {t("directEmail.label")}{" "}
          <a
            href={`mailto:${t("directEmail.address")}`}
            className="text-[var(--primary)] font-medium hover:underline"
          >
            {t("directEmail.address")}
          </a>
        </p>
      </section>
    </main>
  );
}
