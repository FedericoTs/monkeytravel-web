import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/lib/i18n/routing';
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from '@/lib/seo/structured-data';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

const BASE_URL = 'https://monkeytravel.app';
const PAGE_PATH = '/free-ai-trip-planner';

const META: Record<string, { title: string; description: string }> = {
  en: {
    title: 'Free AI Trip Planner — No Credit Card, No Signup | MonkeyTravel',
    description:
      'Plan your perfect trip with AI in seconds. Get personalized day-by-day itineraries with real venues and actual prices. 100% free, no credit card needed.',
  },
  es: {
    title:
      'Planificador de Viajes AI Gratis — Sin Tarjeta, Sin Registro | MonkeyTravel',
    description:
      'Planifica tu viaje perfecto con AI en segundos. Itinerarios personalizados día a día con lugares reales y precios actuales. 100% gratis, sin tarjeta de crédito.',
  },
  it: {
    title:
      'Pianificatore di Viaggi AI Gratuito — Senza Carta, Senza Registrazione | MonkeyTravel',
    description:
      'Pianifica il viaggio perfetto con l\'AI in pochi secondi. Itinerari personalizzati giorno per giorno con luoghi reali e prezzi attuali. 100% gratuito.',
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const meta = META[locale] || META.en;
  const prefix = locale === 'en' ? '' : `/${locale}`;

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${PAGE_PATH}`,
      languages: {
        en: `${BASE_URL}${PAGE_PATH}`,
        es: `${BASE_URL}/es${PAGE_PATH}`,
        it: `${BASE_URL}/it${PAGE_PATH}`,
        'x-default': `${BASE_URL}${PAGE_PATH}`,
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: 'website',
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: 'MonkeyTravel — Free AI Trip Planner',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      images: [`${BASE_URL}/og-image.png`],
    },
  };
}

const FEATURE_KEYS = [
  'aiItineraries',
  'realVenues',
  'smartRouting',
  'multiLanguage',
  'groupPlanning',
  'noSignup',
] as const;

const FEATURE_ICONS = [
  // AI Itineraries
  <svg key="ai" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
  // Real Venues
  <svg key="venues" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  // Smart Routing
  <svg key="routing" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
  // Multi Language
  <svg key="lang" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>,
  // Group Planning
  <svg key="group" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  // No Signup
  <svg key="nosignup" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>,
];

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;
const COMPARISON_KEYS = ['realData', 'routing', 'budget', 'collaboration', 'updates'] as const;
const FAQ_KEYS = ['isFree', 'needAccount', 'howAccurate', 'languages', 'groupTrips', 'destinations'] as const;

export default async function FreeTripPlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freeTripPlanner');
  const prefix = locale === 'en' ? '' : `/${locale}`;

  // Build FAQ data
  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  // Build breadcrumb data
  const breadcrumbItems = [
    { name: t('breadcrumbs.home'), url: `${BASE_URL}${prefix}` },
    {
      name: t('breadcrumbs.freeTripPlanner'),
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
    },
  ];

  return (
    <>
      <script
        {...jsonLdScriptProps([
          generateFAQSchema(faqItems),
          generateBreadcrumbSchema(breadcrumbItems),
        ])}
      />

      <Navbar />

      <main className="min-h-screen">
        {/* ================================================================
            HERO SECTION
            ================================================================ */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[var(--primary)] via-[#0a5a8a] to-[#064060] text-white">
          {/* Decorative orbs */}
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[var(--accent)]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-white/5 blur-3xl" />

          <div className="relative mx-auto max-w-4xl px-4 pb-16 pt-32 text-center sm:px-6 lg:px-8">
            {/* Badge */}
            <span className="mb-6 inline-block rounded-full bg-[var(--accent)]/20 px-4 py-1.5 text-sm font-medium text-[var(--accent)]">
              {t('hero.badge')}
            </span>

            <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              {t('hero.title')}
            </h1>

            <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-white/80 sm:text-xl">
              {t('hero.subtitle')}
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/trips/new"
                className="inline-flex items-center rounded-xl bg-[var(--accent)] px-8 py-4 text-base font-bold text-[#1a1a2e] shadow-lg transition hover:brightness-110"
              >
                {t('hero.cta')}
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center rounded-xl border border-white/30 px-6 py-3.5 text-base font-medium text-white transition hover:bg-white/10"
              >
                {t('hero.secondaryCta')}
              </a>
            </div>
          </div>
        </section>

        {/* ================================================================
            FEATURES GRID
            ================================================================ */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="mb-14 text-center">
              <h2 className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl">
                {t('features.title')}
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-gray-600">
                {t('features.subtitle')}
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_KEYS.map((key, i) => (
                <div
                  key={key}
                  className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">
                    {FEATURE_ICONS[i]}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    {t(`features.items.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {t(`features.items.${key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            HOW IT WORKS
            ================================================================ */}
        <section id="how-it-works" className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-14 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {t('howItWorks.title')}
            </h2>

            <div className="grid gap-10 md:grid-cols-3">
              {STEP_KEYS.map((key, i) => (
                <div key={key} className="text-center">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)] text-xl font-bold text-white">
                    {i + 1}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    {t(`howItWorks.steps.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {t(`howItWorks.steps.${key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            COMPARISON TABLE (MonkeyTravel vs ChatGPT)
            ================================================================ */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <h2 className="mb-3 text-3xl font-bold text-gray-900 sm:text-4xl">
                {t('comparison.title')}
              </h2>
              <p className="text-lg text-gray-600">
                {t('comparison.subtitle')}
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {/* Header */}
              <div className="grid grid-cols-3 border-b border-gray-200 bg-gray-50 text-sm font-semibold">
                <div className="p-4 text-gray-500" />
                <div className="border-l border-gray-200 p-4 text-center text-[var(--primary)]">
                  MonkeyTravel
                </div>
                <div className="border-l border-gray-200 p-4 text-center text-gray-500">
                  ChatGPT
                </div>
              </div>

              {/* Rows */}
              {COMPARISON_KEYS.map((key, i) => (
                <div
                  key={key}
                  className={`grid grid-cols-3 text-sm ${i < COMPARISON_KEYS.length - 1 ? 'border-b border-gray-100' : ''}`}
                >
                  <div className="p-4 font-medium text-gray-900">
                    {t(`comparison.items.${key}.label`)}
                  </div>
                  <div className="flex items-start gap-2 border-l border-gray-100 p-4 text-gray-700">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>{t(`comparison.items.${key}.monkey`)}</span>
                  </div>
                  <div className="flex items-start gap-2 border-l border-gray-100 p-4 text-gray-500">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    <span>{t(`comparison.items.${key}.chatgpt`)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            FAQ
            ================================================================ */}
        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-10 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {t('faq.title')}
            </h2>

            <div className="space-y-4">
              {FAQ_KEYS.map((key) => (
                <details
                  key={key}
                  className="group rounded-xl border border-gray-200 bg-white"
                >
                  <summary className="cursor-pointer list-none px-6 py-5 text-base font-medium text-gray-900 transition hover:text-[var(--primary)] [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between">
                      {t(`faq.items.${key}.question`)}
                      <svg
                        className="ml-4 h-5 w-5 shrink-0 text-gray-400 transition group-open:rotate-180"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </summary>
                  <div className="px-6 pb-5 text-sm leading-relaxed text-gray-600">
                    {t(`faq.items.${key}.answer`)}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            CTA
            ================================================================ */}
        <section className="bg-[#0f172a] py-20 text-white">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              {t('cta.title')}
            </h2>
            <p className="mb-8 text-lg text-white/70">
              {t('cta.subtitle')}
            </p>
            <Link
              href="/trips/new"
              className="inline-flex items-center rounded-xl bg-[var(--accent)] px-8 py-4 text-base font-bold text-[#1a1a2e] shadow-lg transition hover:brightness-110"
            >
              {t('cta.button')}
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
