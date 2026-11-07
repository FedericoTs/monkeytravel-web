import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import FromTheBlog from '@/components/blog/FromTheBlog';
import LiveStats from '@/components/stats/LiveStats';
import LastUpdated from '@/components/seo/LastUpdated';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import LandingWhatIs from '@/components/landing/LandingWhatIs';
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
const CONTENT_UPDATED = '2026-11-07';
const PAGE_PATH = '/budget-trip-planner';

export const generateMetadata = landingMetadata('budgetTripPlanner', PAGE_PATH, 'MonkeyTravel — Budget Trip Planner');

const FEATURES: LandingFeature[] = [
  {
    key: 'priceComparison',
    color: 'bg-amber-50 text-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
  },
  {
    key: 'budgetTiers',
    color: 'bg-emerald-50 text-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    key: 'costBreakdown',
    color: 'bg-blue-50 text-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'cheapFlights',
    color: 'bg-violet-50 text-violet-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    ),
  },
  {
    key: 'affordableStays',
    color: 'bg-rose-50 text-rose-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    key: 'freeActivities',
    color: 'bg-cyan-50 text-cyan-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
      </svg>
    ),
  },
];

const STEP_CONFIGS = [
  {
    key: 'step1',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

const COMPARISON_KEYS = ['pricing', 'personalized', 'tiers', 'upToDate', 'complete'] as const;
const FAQ_KEYS = ['howCheap', 'pricesReal', 'budgetTiers', 'saveMoney', 'hiddenCosts', 'destinations'] as const;

export default async function BudgetTripPlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('budgetTripPlanner');

  // Build FAQ data
  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  return (
    <>
      <LandingStructuredData
        namespace="budgetTripPlanner"
        locale={locale}
        path={PAGE_PATH}
        contentUpdated={CONTENT_UPDATED}
        faqItems={faqItems}
      />

      <Navbar />

      <main className="min-h-screen">
        <LandingHero namespace="budgetTripPlanner" />

        <LandingWhatIs namespace="budgetTripPlanner" />

        <LiveStats locale={locale} />

        <LandingFeatures namespace="budgetTripPlanner" features={FEATURES} />

        <LandingHowItWorks namespace="budgetTripPlanner" steps={STEP_CONFIGS} />

        <LandingComparison namespace="budgetTripPlanner" keys={COMPARISON_KEYS} otherKey="other" />

        <LandingFaq title={t('faq.title')} items={faqItems} />

        {/* ================================================================
            FROM THE BLOG
            ================================================================ */}
        <FromTheBlog
          slugs={['cheapest-destinations-in-europe', 'cheapest-destinations-in-asia', 'how-to-plan-trip-to-italy-on-a-budget']}
          locale={locale}
        />

        <LandingFinalCta namespace="budgetTripPlanner" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
