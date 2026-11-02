import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import EmailSubscribe from '@/components/EmailSubscribe';
import HeroDoodleBackground from '@/components/marketing/HeroDoodleBackground';
import LiveStats from '@/components/stats/LiveStats';
import { HERO_DOODLE_ENABLED } from '@/components/marketing/doodle';
import { Link, routing } from '@/lib/i18n/routing';
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  generateWebPageSchema,
  jsonLdScriptProps,
} from '@/lib/seo/structured-data';
import LastUpdated from '@/components/seo/LastUpdated';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import LandingWhatIs from '@/components/landing/LandingWhatIs';
import LandingFeatures, { type LandingFeature } from '@/components/landing/LandingFeatures';
import LandingHowItWorks from '@/components/landing/LandingHowItWorks';
import LandingFaq from '@/components/landing/LandingFaq';

const BASE_URL = 'https://monkeytravel.app';
/**
 * Content freshness signal. Bump ONLY when this page's copy actually
 * changes — never automate it. A date that moves on every build tells Google
 * the whole site churns and teaches it to discount lastmod everywhere.
 */
const CONTENT_UPDATED = '2026-07-24';
const PAGE_PATH = '/multi-city-trip-planner';

// Pre-render every locale at build time (routing.locales = en/es/it/pt).
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// NOTE: titles deliberately omit "| MonkeyTravel" — the root layout's
// title template ("%s | MonkeyTravel") appends the brand suffix.
const META: Record<string, { title: string; description: string }> = {
  pt: {
    title: 'Planejador de Viagens Multidestino — Roteiros com AI',
    description:
      'Planeje Tóquio→Kyoto→Osaka em um único roteiro. Adicione paradas e noites — a AI divide os dias por cidade automaticamente. Grátis, até 5 cidades e 21 dias.',
  },
  en: {
    title: 'Multi-City Trip Planner — AI Itineraries for 2+ Cities',
    description:
      'Plan Tokyo→Kyoto→Osaka in one itinerary. Add stops and nights — AI splits your days per city automatically. Free, up to 5 cities and 21 days.',
  },
  es: {
    title: 'Planificador de Viajes Multidestino — Itinerarios con AI',
    description:
      'Planifica Tokio→Kioto→Osaka en un solo itinerario. Añade etapas y noches — la AI reparte los días por ciudad automáticamente. Gratis, hasta 5 ciudades y 21 días.',
  },
  it: {
    title: 'Pianificatore di Viaggi Multi-Città — Itinerari con AI',
    description:
      'Pianifica Tokyo→Kyoto→Osaka in un solo itinerario. Aggiungi tappe e notti — l\'AI divide i giorni per città in automatico. Gratis, fino a 5 città e 21 giorni.',
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
    // `absolute` opts out of the root "%s | MonkeyTravel" template.
    // These pages target generic commercial terms where the brand buys
    // nothing and costs 15 of ~60 rendered characters. Homepage keeps it.
    title: { absolute: meta.title },
    description: meta.description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${PAGE_PATH}`,
      languages: {
        en: `${BASE_URL}${PAGE_PATH}`,
        es: `${BASE_URL}/es${PAGE_PATH}`,
        it: `${BASE_URL}/it${PAGE_PATH}`,
        pt: `${BASE_URL}/pt${PAGE_PATH}`,
        'x-default': `${BASE_URL}${PAGE_PATH}`,
      },
    },
    openGraph: {
      siteName: "MonkeyTravel",
      title: meta.title,
      description: meta.description,
      type: 'website',
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: 'MonkeyTravel — Multi-City Trip Planner',
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

const FEATURES: LandingFeature[] = [
  {
    key: 'dayAllocation',
    color: 'bg-amber-50 text-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'journeyOverview',
    color: 'bg-blue-50 text-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
  {
    key: 'citiesAndDays',
    color: 'bg-emerald-50 text-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    key: 'groupVoting',
    color: 'bg-rose-50 text-rose-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
];

const STEP_CONFIGS = [
  {
    key: 'step1',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'step2',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    key: 'step3',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
      </svg>
    ),
  },
];

const ROUTE_KEYS = ['japan', 'greece', 'iberia', 'italy'] as const;
const FAQ_KEYS = ['splitDays', 'cityLimit', 'longTrips', 'isFree', 'groupVoting'] as const;

export default async function MultiCityTripPlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('multiCityTripPlanner');
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
      name: t('breadcrumbs.multiCityTripPlanner'),
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
    },
  ];


  return (
    <>
      <script
        {...jsonLdScriptProps([
          generateFAQSchema(faqItems),
          generateBreadcrumbSchema(breadcrumbItems),
          generateWebPageSchema({
            name: breadcrumbItems[breadcrumbItems.length - 1].name,
            url: breadcrumbItems[breadcrumbItems.length - 1].url,
            dateModified: CONTENT_UPDATED,
          }),
        ])}
      />

      <Navbar />

      <main className="min-h-screen">
        {/* ================================================================
            HERO SECTION
            ================================================================ */}
        <section className="relative min-h-[80vh] pt-20 pb-16 overflow-hidden hero-gradient">
          {HERO_DOODLE_ENABLED ? (
            <HeroDoodleBackground layout="centered" />
          ) : (
            <>
              {/* Grid overlay */}
              <div className="absolute inset-0 bg-grid-pattern-light opacity-50" />

              {/* Animated orbs */}
              <div className="absolute top-32 left-[10%] w-72 h-72 bg-[var(--accent)]/10 rounded-full blur-[100px] animate-pulse-glow" />
              <div className="absolute top-64 right-[5%] w-96 h-96 bg-[var(--primary)]/8 rounded-full blur-[120px] animate-pulse-glow" style={{ animationDelay: '2s' }} />
            </>
          )}

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-sm font-semibold text-emerald-700">
                {t('hero.badge')}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
              {t('hero.title')}
            </h1>

            <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-10 max-w-2xl leading-relaxed">
              {t('hero.subtitle')}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                href="/trips/new?multi=1"
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--foreground)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30"
              >
                <span>{t('hero.cta')}</span>
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-gray-200 text-[var(--foreground)] font-semibold rounded-xl hover:border-[var(--primary)] hover:text-[var(--primary-ink)] transition-all"
              >
                {t('hero.secondaryCta')}
              </a>
            </div>

            {/* Trust Signals */}
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-[var(--foreground-muted)]">
              {(['free', 'cities', 'days'] as const).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{t(`hero.trustSignals.${key}`)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <LandingWhatIs namespace="multiCityTripPlanner" />

        <LiveStats locale={locale} />

        <LandingFeatures namespace="multiCityTripPlanner" features={FEATURES} columns={4} />

        <LandingHowItWorks namespace="multiCityTripPlanner" steps={STEP_CONFIGS} />

        {/* ================================================================
            POPULAR MULTI-CITY ROUTES
            ================================================================ */}
        <section id="routes" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary-ink)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {t('routes.title')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('routes.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {t('routes.subtitle')}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {ROUTE_KEYS.map((key) => (
                <Link
                  key={key}
                  href="/trips/new?multi=1"
                  className="group relative flex flex-col p-8 rounded-3xl bg-[var(--background-alt)] border border-gray-100 card-hover"
                >
                  <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">
                    {t(`routes.items.${key}.name`)}
                  </h3>
                  <div className="text-[var(--primary-ink)] font-bold mb-3">
                    {t(`routes.items.${key}.stops`)}
                  </div>
                  <p className="text-sm text-[var(--foreground-muted)] leading-relaxed mb-6">
                    {t(`routes.items.${key}.description`)}
                  </p>
                  <div className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary-ink)]">
                    <span>{t('routes.cta')}</span>
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <LandingFaq title={t('faq.title')} items={faqItems} badge={t('faq.badge')} />

        {/* ================================================================
            FINAL CTA
            ================================================================ */}
        <section className="py-24 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-[2.5rem] mesh-gradient p-12 sm:p-16 lg:p-20">
              {/* Grid overlay */}
              <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--accent)]/20 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-[var(--primary-light)]/20 rounded-full blur-[80px]" />

              <div className="relative text-center">
                {/* Live badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm font-semibold text-white/90 mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                  </span>
                  {t('hero.trustSignals.free')}
                </div>

                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">
                  {t('cta.title')}
                </h2>
                <p className="text-lg sm:text-xl text-white/70 mb-10 max-w-2xl mx-auto leading-relaxed">
                  {t('cta.subtitle')}
                </p>

                {/* CTA button */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                  <Link
                    href="/trips/new?multi=1"
                    className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--foreground)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all"
                  >
                    <span>{t('cta.button')}</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                </div>

                {/* Newsletter signup */}
                <div className="pt-8 border-t border-white/10 max-w-md mx-auto">
                  <p className="text-sm text-white/55 mb-4">
                    {t('cta.mobileNotify')}
                  </p>
                  <EmailSubscribe variant="dark" source="multi-city-trip-planner-cta" />
                </div>
              </div>
            </div>
          </div>
        </section>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
