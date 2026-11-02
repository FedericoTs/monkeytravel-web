import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import LiveStats from '@/components/stats/LiveStats';
import PhoneMockup from '@/components/PhoneMockup';
import LastUpdated from '@/components/seo/LastUpdated';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import LandingFeatures, { type LandingFeature } from '@/components/landing/LandingFeatures';
import LandingHowItWorks from '@/components/landing/LandingHowItWorks';
import LandingFaq from '@/components/landing/LandingFaq';
import LandingHero from '@/components/landing/LandingHero';
import LandingComparison from '@/components/landing/LandingComparison';
import LandingFinalCta from '@/components/landing/LandingFinalCta';
import LandingStructuredData from '@/components/landing/LandingStructuredData';
import { landingMetadata } from '@/lib/seo/landing-metadata';

/**
 * Content freshness signal. Bump ONLY when this page's copy actually
 * changes — never automate it. A date that moves on every build tells Google
 * the whole site churns and teaches it to discount lastmod everywhere.
 */
const CONTENT_UPDATED = '2026-08-21';
const PAGE_PATH = '/free-ai-trip-planner';

const META: Record<string, { title: string; description: string }> = {
  pt: {
    title: 'Planejador de Viagens com AI Grátis — Sem Cadastro',
    description:
      'Crie roteiros personalizados dia a dia com lugares reais e 3 níveis de orçamento em 30 segundos. Funciona em português, inglês, espanhol e italiano. Sem conta, nunca.',
  },
  en: {
    title: 'Free AI Trip Planner — No Signup, No Card',
    description:
      'Create personalized day-by-day itineraries with real venues and 3 budget tiers in 30 seconds. Works in English, Spanish, Italian & Portuguese. No account required, ever.',
  },
  es: {
    title:
      'Planificador de Viajes AI Gratis — Sin Registro, Sin Tarjeta',
    description:
      'Crea itinerarios personalizados día a día con lugares reales y 3 niveles de presupuesto en 30 segundos. Sin cuenta necesaria, nunca.',
  },
  it: {
    title:
      'Pianificatore di Viaggi AI Gratis — Senza Account',
    description:
      'Crea itinerari personalizzati giorno per giorno con luoghi reali e 3 livelli di budget in 30 secondi. Nessun account necessario, mai.',
  },
};

export const generateMetadata = landingMetadata(META, PAGE_PATH, 'MonkeyTravel — Free AI Trip Planner');

const FEATURES: LandingFeature[] = [
  {
    key: 'aiItineraries',
    color: 'bg-amber-50 text-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    key: 'realVenues',
    color: 'bg-emerald-50 text-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    key: 'smartRouting',
    color: 'bg-blue-50 text-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
  {
    key: 'multiLanguage',
    color: 'bg-violet-50 text-violet-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
      </svg>
    ),
  },
  {
    key: 'groupPlanning',
    color: 'bg-rose-50 text-rose-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    key: 'noSignup',
    color: 'bg-cyan-50 text-cyan-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
];

const STEP_CONFIGS = [
  {
    key: 'step1',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
];

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

  // Build FAQ data
  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  return (
    <>
      <LandingStructuredData
        namespace="freeTripPlanner"
        locale={locale}
        path={PAGE_PATH}
        contentUpdated={CONTENT_UPDATED}
        faqItems={faqItems}
      />

      <Navbar />

      <main className="min-h-screen">
        <LandingHero namespace="freeTripPlanner" />

        <LiveStats locale={locale} />

        {/* ================================================================
            WHAT IS AN AI TRIP PLANNER — definitional block
            ================================================================
            The page used to open on a benefit claim ("get an itinerary in
            under 60 seconds") and never define its own category, so it could
            not answer a "what is an ai trip planner" query at all. It also
            scored 0 of 20 sections inside the 134-167 word band that
            extraction models favour — everything was either a 19-28 word
            feature blurb or one 218-word FAQ lump. See docs/GEO-ANALYSIS.md.

            This block is the fix: one self-contained answer, long enough to
            lift whole. Copy lives under `whatIs` in
            messages/{en,es,it,pt}/freeTripPlanner.json and runs 134-143 words
            per locale — keep it inside that band when editing.
            ================================================================ */}
        <section className="py-20 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-12 lg:gap-16 items-center">
              <div>
                <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-6">
                  {t('whatIs.heading')}
                </h2>
                <div className="space-y-4 text-lg leading-relaxed text-[var(--foreground-muted)]">
                  <p>{t('whatIs.definition')}</p>
                  <p>{t('whatIs.vsChatbot')}</p>
                  <p>{t('whatIs.product')}</p>
                  <p>{t('whatIs.honest')}</p>
                </div>
              </div>

              {/* A real generated itinerary, not an illustration. The audit
                  found all 13 images on this page were chrome — decorative
                  hero layers with correctly-empty alt — so the page had no
                  substantive imagery at all (GEO-ANALYSIS finding 6).

                  Deliberately NOT hidden on small screens. The obvious
                  layout instinct here is `hidden lg:flex`, which would drop
                  the image from the MOBILE dom — and Google indexes
                  mobile-first, so the crawler would never see the one
                  content image on the page. It stacks instead. */}
              <div className="flex justify-center">
                <PhoneMockup
                  scale="lg"
                  screenImage="/screenshots/trip-barcelona-itinerary.webp"
                  alt={t('whatIs.imageAlt')}
                />
              </div>
            </div>
          </div>
        </section>

        <LandingFeatures namespace="freeTripPlanner" features={FEATURES} />

        <LandingHowItWorks namespace="freeTripPlanner" steps={STEP_CONFIGS} />

        <LandingComparison namespace="freeTripPlanner" keys={COMPARISON_KEYS} otherLabel="ChatGPT" otherKey="chatgpt" />

        <LandingFaq title={t('faq.title')} items={faqItems} />

        <LandingFinalCta namespace="freeTripPlanner" subscribeSource="free-trip-planner-cta" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
