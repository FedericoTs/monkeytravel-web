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
const CONTENT_UPDATED = '2026-11-02';
const PAGE_PATH = '/family-trip-planner';

export const generateMetadata = landingMetadata('familyTripPlanner', PAGE_PATH, 'MonkeyTravel — Family Trip Planner');

const FEATURES: LandingFeature[] = [
  {
    key: 'kidFriendly',
    color: 'bg-rose-50 text-rose-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    key: 'ageAppropriate',
    color: 'bg-amber-50 text-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ),
  },
  {
    key: 'familyBudget',
    color: 'bg-emerald-50 text-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'safeDestinations',
    color: 'bg-blue-50 text-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    key: 'familySchedule',
    color: 'bg-violet-50 text-violet-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'familyDining',
    color: 'bg-cyan-50 text-cyan-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
      </svg>
    ),
  },
];

const STEP_CONFIGS = [
  {
    key: 'step1',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
];

const COMPARISON_KEYS = ['kidFriendly', 'scheduling', 'dining', 'budget', 'routing'] as const;
const FAQ_KEYS = ['whatAges', 'isFree', 'howSafe', 'specialNeeds', 'multiFamily', 'destinations'] as const;

export default async function FamilyTripPlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('familyTripPlanner');

  // Build FAQ data
  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  return (
    <>
      <LandingStructuredData
        namespace="familyTripPlanner"
        locale={locale}
        path={PAGE_PATH}
        contentUpdated={CONTENT_UPDATED}
        faqItems={faqItems}
      />

      <Navbar />

      <main className="min-h-screen">
        <LandingHero namespace="familyTripPlanner" />

        <LandingWhatIs namespace="familyTripPlanner" />

        <LiveStats locale={locale} />

        <LandingFeatures namespace="familyTripPlanner" features={FEATURES} />

        <LandingHowItWorks namespace="familyTripPlanner" steps={STEP_CONFIGS} />

        <LandingComparison namespace="familyTripPlanner" keys={COMPARISON_KEYS} otherKey="manual" />

        <LandingFaq title={t('faq.title')} items={faqItems} />

        {/* ================================================================
            FROM THE BLOG
            ================================================================ */}
        <FromTheBlog
          slugs={['how-to-plan-a-group-trip', '5-day-italy-itinerary', 'best-group-trip-destinations-2026']}
          locale={locale}
        />

        <LandingFinalCta namespace="familyTripPlanner" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
