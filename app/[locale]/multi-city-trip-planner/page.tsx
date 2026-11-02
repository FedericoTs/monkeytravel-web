import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import LiveStats from '@/components/stats/LiveStats';
import { Link, routing } from '@/lib/i18n/routing';
import LastUpdated from '@/components/seo/LastUpdated';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import LandingWhatIs from '@/components/landing/LandingWhatIs';
import LandingFeatures, { type LandingFeature } from '@/components/landing/LandingFeatures';
import LandingHowItWorks from '@/components/landing/LandingHowItWorks';
import LandingFaq from '@/components/landing/LandingFaq';
import LandingHero from '@/components/landing/LandingHero';
import LandingFinalCta from '@/components/landing/LandingFinalCta';
import LandingStructuredData from '@/components/landing/LandingStructuredData';
import { landingMetadata } from '@/lib/seo/landing-metadata';

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

export const generateMetadata = landingMetadata(META, PAGE_PATH, 'MonkeyTravel — Multi-City Trip Planner');

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

  // Build FAQ data
  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  return (
    <>
      <LandingStructuredData
        namespace="multiCityTripPlanner"
        locale={locale}
        path={PAGE_PATH}
        contentUpdated={CONTENT_UPDATED}
        faqItems={faqItems}
      />

      <Navbar />

      <main className="min-h-screen">
        <LandingHero namespace="multiCityTripPlanner" ctaHref="/trips/new?multi=1" trustSignals={['free', 'cities', 'days']} />

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

        <LandingFinalCta namespace="multiCityTripPlanner" subscribeSource="multi-city-trip-planner-cta" ctaHref="/trips/new?multi=1" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
